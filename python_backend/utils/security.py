"""Security helpers for authentication, Origin validation, SSRF protection, and safe file paths."""
from __future__ import annotations

import hmac
import ipaddress
import os
import re
import socket
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import Header, HTTPException, WebSocket

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = _BACKEND_DIR.parent

_SENSITIVE_NAMES = {
    ".env",
    ".git",
    ".gitignore",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "data",
    ".claude",
    ".vscode",
    "id_rsa",
    "id_ed25519",
    "authorized_keys",
}

_SENSITIVE_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".key", ".pem", ".cert", ".p12", ".pfx", ".env"}

_PROTECTED_WRITE_PATTERNS = {
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "vite.config.js",
    "tsconfig.json",
    "index.html",
    "requirements.txt",
}

_PROTECTED_WRITE_DIRS = {"python_backend", "server", "src", ".git", ".vscode", ".claude", "data", "dist", "node_modules"}
_PROTECTED_WRITE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".bat", ".sh", ".ps1", ".exe", ".dll", ".cmd"}

_IDENTIFIER_RE = re.compile(r"^[a-zA-Z0-9_\-.:]{1,128}$")


def sanitize_error_message(exc: Exception, fallback: str = "An unexpected internal error occurred.") -> str:
    """Return a generic non-sensitive error string, redacting credentials and filesystem paths."""
    raw = str(exc or "").strip()
    if not raw:
        return fallback
    # Never expose keys or local filesystem paths in API errors
    if any(token in raw for token in ("sk-", "sk_", "AIza", "xai-", "sb_secret", "Bearer ", "C:\\", "/Users/", "/home/")):
        return fallback
    return raw[:200]


def validate_identifier(value: str, field_name: str = "identifier") -> str:
    """Ensure session IDs and keys conform to safe character constraints."""
    cleaned = (value or "").strip()
    if not _IDENTIFIER_RE.match(cleaned):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format.")
    return cleaned


def get_live_admin_secret() -> Optional[str]:
    """Resolve ADMIN_SECRET from .env files or environment variables."""
    for env_path in (_PROJECT_ROOT / ".env", _BACKEND_DIR / ".env"):
        try:
            if env_path.exists():
                content = env_path.read_text(encoding="utf-8")
                match = re.search(r"^ADMIN_SECRET\s*=\s*(.*)$", content, flags=re.MULTILINE)
                if match and match.group(1):
                    val = match.group(1).strip()
                    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    if "#" in val:
                        val = val.split("#", 1)[0].strip()
                    if val and val != "YOUR_SECURE_ADMIN_PASSWORD_HERE":
                        return val
        except OSError:
            pass
    env_val = (os.environ.get("ADMIN_SECRET") or "").strip()
    if env_val and env_val != "YOUR_SECURE_ADMIN_PASSWORD_HERE":
        return env_val
    return None


async def require_admin_auth(
    x_admin_secret: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> None:
    """FastAPI dependency enforcing timing-safe ADMIN_SECRET verification."""
    secret = get_live_admin_secret()
    if not secret:
        raise HTTPException(status_code=403, detail="Admin access is not configured on this server.")

    candidate = (x_admin_secret or "").strip()
    if not candidate and authorization and authorization.startswith("Bearer "):
        candidate = authorization[7:].strip()

    if not candidate or not hmac.compare_digest(candidate.encode("utf-8"), secret.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Unauthorized: valid admin credentials required.")


def is_allowed_ws_origin(websocket: WebSocket, allowed_origins: list[str]) -> bool:
    """Validate WebSocket Origin header strictly via parsed hostname to prevent CSWSH."""
    origin = websocket.headers.get("origin")
    if not origin:
        # Non-browser clients (CLI/TestClient) omit Origin; only allow if request came directly from loopback.
        client_host = websocket.client.host if websocket.client else ""
        return client_host in ("127.0.0.1", "::1", "testclient", "")

    try:
        parsed = urlparse(origin.strip())
    except ValueError:
        return False

    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False

    if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return True

    normalized_origin = f"{parsed.scheme}://{parsed.netloc}".lower()
    return normalized_origin in {o.rstrip("/").lower() for o in allowed_origins}


def _is_forbidden_ip(ip_obj: ipaddress._BaseAddress) -> bool:
    """Return True if an IP address is loopback, private, link-local, multicast, or reserved."""
    if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped:
        ip_obj = ip_obj.ipv4_mapped
    return (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def validate_public_http_url(url: str) -> str:
    """Strict SSRF guard validating scheme, host, and all resolved IP addresses."""
    raw = (url or "").strip()
    if not raw or any(ch in raw for ch in ("\x00", "\r", "\n")):
        raise ValueError("URL contains invalid control characters.")

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL must be a valid http:// or https:// address.")
    if parsed.username or parsed.password:
        raise ValueError("Embedded URL credentials are not allowed.")

    host = parsed.hostname.lower().rstrip(".")
    if host in ("localhost", "ip6-localhost") or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Access to internal/local hostnames is restricted.")

    # Direct IP literal check
    try:
        ip_literal = ipaddress.ip_address(host)
        if _is_forbidden_ip(ip_literal):
            raise ValueError("Access to private or loopback IP addresses is restricted.")
        return raw
    except ValueError as ip_err:
        if "restricted" in str(ip_err):
            raise

    # DNS resolution check
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addr_infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve hostname: {exc}") from exc

    if not addr_infos:
        raise ValueError("Hostname resolved to no usable IP addresses.")

    for info in addr_infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        ip_str = sockaddr[0].split("%", 1)[0]
        resolved_ip = ipaddress.ip_address(ip_str)
        if _is_forbidden_ip(resolved_ip):
            raise ValueError("Access to private, loopback, or metadata networks is restricted.")

    return raw


def safe_workspace_path(requested: str, for_write: bool = False) -> Optional[Path]:
    """Resolve a path strictly inside project root, blocking secrets, symlinks, and system files."""
    clean = (requested or ".").replace("\x00", "").strip()
    if not clean:
        clean = "."

    try:
        root = _PROJECT_ROOT.resolve()
        candidate = root / clean
        resolved = candidate.resolve()
        rel = resolved.relative_to(root)
    except (ValueError, OSError):
        return None

    # Block any path component matching sensitive files/folders (.env, .git, data, .venv, etc.)
    for part in rel.parts:
        lower = part.lower()
        if lower in _SENSITIVE_NAMES or lower.startswith(".env"):
            return None

    if resolved.name.lower().startswith(".env") or resolved.suffix.lower() in _SENSITIVE_EXTENSIONS:
        return None

    if for_write:
        if resolved.name.lower() in _PROTECTED_WRITE_PATTERNS:
            return None
        if resolved.suffix.lower() in _PROTECTED_WRITE_EXTENSIONS:
            return None
        if rel.parts and rel.parts[0].lower() in _PROTECTED_WRITE_DIRS:
            return None

    return resolved
