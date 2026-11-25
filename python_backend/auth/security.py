"""Cryptographic password hashing, opaque DB session tokens, and auth helpers."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Optional, Tuple

from fastapi import HTTPException, Request, Response, status

from config import get_settings

SESSION_COOKIE_NAME = "aura_session"
SESSION_TTL_DEFAULT_SEC = 24 * 60 * 60          # 24 hours
SESSION_TTL_REMEMBER_SEC = 30 * 24 * 60 * 60    # 30 days

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$")
_RATE_BUCKETS: Dict[str, Deque[float]] = {}
_RATE_WINDOW_SEC = 300.0
_RATE_MAX_ATTEMPTS = 20

# Precompute a valid dummy hash for constant-time rejection when email does not exist
_DUMMY_SALT = b"aura-dummy-salt!"
_DUMMY_HASH = (
    "scrypt$16384$8$1$"
    + _DUMMY_SALT.hex()
    + "$"
    + hashlib.scrypt(b"dummy-password-check", salt=_DUMMY_SALT, n=2**14, r=8, p=1, dklen=32).hex()
)


def hash_password(password: str) -> str:
    """Hash a plaintext password using memory-hard scrypt with random 16-byte salt."""
    salt = os.urandom(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: Optional[str]) -> bool:
    """Verify a plaintext password against a scrypt digest in constant time."""
    target = stored_hash or _DUMMY_HASH
    try:
        scheme, n_s, r_s, p_s, salt_hex, hash_hex = target.split("$")
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=32,
        )
        matched = hmac.compare_digest(derived, bytes.fromhex(hash_hex))
        return bool(stored_hash) and matched
    except Exception:
        return False


def normalize_email(raw_email: str) -> str:
    """Validate and normalize an email address."""
    clean = (raw_email or "").replace("\x00", "").strip().lower()
    if not clean or len(clean) > 254 or not _EMAIL_RE.match(clean):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a valid email address.")
    return clean


def validate_password_strength(password: str) -> str:
    """Validate password length constraints cleanly without blocking special characters or pasting."""
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be between 8 and 128 characters long.",
        )
    if "\x00" in password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password characters.")
    return password


def issue_session_token() -> Tuple[str, str]:
    """Generate a CSPRNG session token and its SHA-256 DB lookup digest."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_session_token(raw)


def hash_session_token(raw_token: str) -> str:
    """Hash a raw session token for storage/lookup in SQLite."""
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def extract_session_token(request: Request) -> Optional[str]:
    """Read raw session token from HttpOnly cookie or Authorization Bearer header."""
    cookie_val = (request.cookies.get(SESSION_COOKIE_NAME) or "").strip()
    if cookie_val:
        return cookie_val
    auth_header = (request.headers.get("authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token
    return None


def set_session_cookie(response: Response, request: Request, raw_token: str, remember_me: bool) -> None:
    """Attach the HttpOnly SameSite=Lax session cookie to the response."""
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        max_age=SESSION_TTL_REMEMBER_SEC if remember_me else None,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    """Clear the HttpOnly session cookie."""
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )


def enforce_auth_rate_limit(request: Request, action: str) -> None:
    """Simple sliding-window rate limiter on authentication endpoints."""
    client_host = request.client.host if request.client else "unknown"
    key = f"{action}:{client_host}"
    now = time.monotonic()

    if len(_RATE_BUCKETS) > 1000:
        stale_keys = [k for k, dq in _RATE_BUCKETS.items() if not dq or now - dq[-1] > _RATE_WINDOW_SEC]
        for k in stale_keys:
            _RATE_BUCKETS.pop(k, None)

    bucket = _RATE_BUCKETS.setdefault(key, deque())
    while bucket and now - bucket[0] > _RATE_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Please wait a few minutes and try again.",
        )
    bucket.append(now)


def get_live_google_client_id() -> Optional[str]:
    """Resolve Google OAuth Client ID dynamically from env or .env files."""
    for key in ("GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID"):
        val = (os.getenv(key) or "").strip()
        if val:
            return val

    backend_dir = Path(__file__).resolve().parent.parent
    for env_path in (backend_dir / ".env", backend_dir.parent / ".env"):
        if not env_path.exists():
            continue
        try:
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() in ("GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID"):
                    val = v.strip().strip('"').strip("'")
                    if val and not val.startswith("your_"):
                        return val
        except Exception:
            pass

    settings = get_settings()
    return settings.effective_google_client_id
