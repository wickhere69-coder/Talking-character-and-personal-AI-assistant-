"""Authentication REST endpoints (/api/auth/*) for email/password & Google OAuth."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from auth.security import (
    SESSION_TTL_DEFAULT_SEC,
    SESSION_TTL_REMEMBER_SEC,
    clear_session_cookie,
    enforce_auth_rate_limit,
    extract_session_token,
    get_live_google_client_id,
    hash_password,
    hash_session_token,
    issue_session_token,
    normalize_email,
    set_session_cookie,
    validate_password_strength,
    verify_password,
)
from memory.store import get_memory_store
from utils.logger import get_logger
from utils.sanitizer import sanitize_string

logger = get_logger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    displayName: Optional[str] = Field(default=None, max_length=80)
    rememberMe: bool = True
    termsAccepted: bool = False


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)
    rememberMe: bool = True


class GoogleAuthRequest(BaseModel):
    credential: str = Field(..., min_length=20, max_length=8192)
    rememberMe: bool = True


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


def _format_user(row: Any) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "displayName": row["display_name"],
        "avatarUrl": row["avatar_url"],
        "authProvider": row["auth_provider"],
        "createdAt": row["created_at"],
    }


async def _create_db_session(user_id: int, remember_me: bool) -> str:
    raw_token, token_hash = issue_session_token()
    now_sec = int(time.time())
    ttl_sec = SESSION_TTL_REMEMBER_SEC if remember_me else SESSION_TTL_DEFAULT_SEC
    expires_sec = now_sec + ttl_sec

    store = get_memory_store()
    async with store.get_connection() as conn:
        await conn.execute(
            "DELETE FROM user_sessions WHERE expires_at <= ?",
            (now_sec,),
        )
        await conn.execute(
            """
            INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at, remember_me)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token_hash, user_id, now_sec, expires_sec, 1 if remember_me else 0),
        )
        await conn.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            (now_sec, user_id),
        )
        await conn.commit()

    return raw_token


@router.get("/config")
async def auth_config() -> Dict[str, Any]:
    """Return safe public auth configuration (never secrets)."""
    client_id = get_live_google_client_id()
    return {
        "googleClientId": client_id,
        "googleConfigured": bool(client_id),
    }


@router.post("/register")
async def register(payload: RegisterRequest, request: Request, response: Response) -> Dict[str, Any]:
    """Create a new local email/password user account and issue a persistent session cookie."""
    enforce_auth_rate_limit(request, "register")

    if not payload.termsAccepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please accept the Terms & Conditions to create an account.",
        )

    email = normalize_email(payload.email)
    password = validate_password_strength(payload.password)
    fallback_name = email.split("@", 1)[0][:40] or "Aura User"
    display_name = sanitize_string((payload.displayName or "").strip(), 80) or fallback_name
    pw_hash = hash_password(password)
    now_sec = int(time.time())

    store = get_memory_store()
    async with store.get_connection() as conn:
        existing = await (
            await conn.execute("SELECT id FROM users WHERE email = ?", (email,))
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            )

        cursor = await conn.execute(
            """
            INSERT INTO users (email, password_hash, display_name, auth_provider, terms_accepted, created_at, last_login)
            VALUES (?, ?, ?, 'password', 1, ?, ?)
            """,
            (email, pw_hash, display_name, now_sec, now_sec),
        )
        user_id = cursor.lastrowid
        await conn.commit()

        user_row = await (
            await conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        ).fetchone()

    raw_token = await _create_db_session(user_row["id"], payload.rememberMe)
    set_session_cookie(response, request, raw_token, payload.rememberMe)
    return {"user": _format_user(user_row), "rememberMe": payload.rememberMe}


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response) -> Dict[str, Any]:
    """Authenticate with email and password."""
    enforce_auth_rate_limit(request, "login")
    email = normalize_email(payload.email)

    store = get_memory_store()
    async with store.get_connection() as conn:
        user_row = await (
            await conn.execute("SELECT * FROM users WHERE email = ?", (email,))
        ).fetchone()

    stored_hash = user_row["password_hash"] if user_row else None
    if not verify_password(payload.password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    raw_token = await _create_db_session(user_row["id"], payload.rememberMe)
    set_session_cookie(response, request, raw_token, payload.rememberMe)
    return {"user": _format_user(user_row), "rememberMe": payload.rememberMe}


@router.post("/google")
async def google_login(payload: GoogleAuthRequest, request: Request, response: Response) -> Dict[str, Any]:
    """Verify a Google Identity Services ID token and sign in or create the user."""
    enforce_auth_rate_limit(request, "google")

    client_id = get_live_google_client_id()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Sign-In requires GOOGLE_CLIENT_ID to be configured on the server.",
        )

    def _verify() -> Dict[str, Any]:
        return google_id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            audience=client_id,
            clock_skew_in_seconds=15,
        )

    try:
        idinfo = await asyncio.to_thread(_verify)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google Sign-In credential.",
        )

    issuer = str(idinfo.get("iss") or "")
    if issuer not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token issuer.")

    if not idinfo.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your Google email address must be verified before signing in.",
        )

    email = normalize_email(str(idinfo.get("email") or ""))
    google_sub = str(idinfo.get("sub") or "").strip()
    if not google_sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Google subject identifier.")

    display_name = sanitize_string(str(idinfo.get("name") or email.split("@", 1)[0]), 80) or "Aura User"
    avatar_url = str(idinfo.get("picture") or "").strip()[:512] or None
    if avatar_url and not avatar_url.startswith("https://"):
        avatar_url = None
    now_sec = int(time.time())

    store = get_memory_store()
    async with store.get_connection() as conn:
        user_row = await (
            await conn.execute(
                "SELECT * FROM users WHERE google_id = ? OR email = ? LIMIT 1",
                (google_sub, email),
            )
        ).fetchone()

        if user_row:
            await conn.execute(
                """
                UPDATE users
                SET google_id = COALESCE(google_id, ?),
                    avatar_url = COALESCE(avatar_url, ?),
                    terms_accepted = 1,
                    last_login = ?
                WHERE id = ?
                """,
                (google_sub, avatar_url, now_sec, user_row["id"]),
            )
            await conn.commit()
            user_row = await (
                await conn.execute("SELECT * FROM users WHERE id = ?", (user_row["id"],))
            ).fetchone()
        else:
            cursor = await conn.execute(
                """
                INSERT INTO users (email, google_id, display_name, avatar_url, auth_provider, terms_accepted, created_at, last_login)
                VALUES (?, ?, ?, ?, 'google', 1, ?, ?)
                """,
                (email, google_sub, display_name, avatar_url, now_sec, now_sec),
            )
            user_id = cursor.lastrowid
            await conn.commit()
            user_row = await (
                await conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            ).fetchone()

    raw_token = await _create_db_session(user_row["id"], payload.rememberMe)
    set_session_cookie(response, request, raw_token, payload.rememberMe)
    return {"user": _format_user(user_row), "rememberMe": payload.rememberMe}


@router.get("/me")
async def get_current_user(request: Request, response: Response) -> Dict[str, Any]:
    """Validate the current HttpOnly session cookie (or Bearer token) and return the user."""
    raw_token = extract_session_token(request)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    token_hash = hash_session_token(raw_token)
    now_sec = int(time.time())

    store = get_memory_store()
    async with store.get_connection() as conn:
        row = await (
            await conn.execute(
                """
                SELECT u.*, s.remember_me, s.expires_at
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                LIMIT 1
                """,
                (token_hash, now_sec),
            )
        ).fetchone()

        if not row:
            await conn.execute("DELETE FROM user_sessions WHERE token_hash = ?", (token_hash,))
            await conn.commit()
            clear_session_cookie(response, request)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid.")

    return {"user": _format_user(row), "rememberMe": bool(row["remember_me"])}


@router.post("/logout")
async def logout(request: Request, response: Response) -> Dict[str, Any]:
    """Revoke the current user session token and clear the HttpOnly cookie."""
    raw_token = extract_session_token(request)
    if raw_token:
        token_hash = hash_session_token(raw_token)
        store = get_memory_store()
        async with store.get_connection() as conn:
            await conn.execute("DELETE FROM user_sessions WHERE token_hash = ?", (token_hash,))
            await conn.commit()

    clear_session_cookie(response, request)
    return {"success": True}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request) -> Dict[str, Any]:
    """Handle password recovery requests cleanly without leaking account existence."""
    enforce_auth_rate_limit(request, "forgot_password")
    normalize_email(payload.email)
    return {
        "success": True,
        "message": "If an account exists for that email address, recovery instructions have been noted. Google accounts sign in via Google.",
    }
