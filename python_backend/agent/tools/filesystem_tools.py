"""Filesystem tools — sandboxed to the project directory."""
from __future__ import annotations

import asyncio
import fnmatch
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import get_logger
from utils.security import safe_workspace_path

logger = get_logger(__name__)

# Security boundary: only allow access within the project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # talking-character-app/
_SKIP_NAMES = {"node_modules", "dist", "data", "venv", "python_backend", "server"}
_MAX_READ_BYTES = 1_048_576


async def list_files(path: str = ".") -> Dict[str, Any]:
    """List files in a directory within the project."""
    safe = safe_workspace_path(path, for_write=False)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Path is outside the allowed project directory or restricted."}

    try:
        entries = await asyncio.to_thread(_list_dir, safe)
        return {
            "success": True,
            "data": entries,
            "message": f"Contents of {path}:\n" + "\n".join(f"• {e}" for e in entries),
        }
    except FileNotFoundError:
        return {"success": False, "error": "Not found", "message": f'Directory "{path}" does not exist.'}
    except Exception as exc:
        return {"success": False, "error": "List failed", "message": f"Could not list directory: {type(exc).__name__}"}


def _list_dir(p: Path) -> List[str]:
    entries = []
    for item in sorted(p.iterdir()):
        lower = item.name.lower()
        if lower.startswith(".") or lower in _SKIP_NAMES:
            continue
        if item.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".key", ".pem", ".cert"}:
            continue
        suffix = "/" if item.is_dir() else ""
        entries.append(item.name + suffix)
    return entries


async def read_file(path: str) -> Dict[str, Any]:
    """Read a file's contents within the project."""
    safe = safe_workspace_path(path, for_write=False)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Path is restricted or outside the allowed project directory."}

    try:
        size = await asyncio.to_thread(lambda: safe.stat().st_size)
        if size > _MAX_READ_BYTES:
            return {"success": False, "error": "File too large", "message": "File exceeds the 1 MB read safety limit."}
        content = await asyncio.to_thread(safe.read_text, "utf-8", "replace")
        preview = content[:3000]
        return {
            "success": True,
            "data": preview,
            "message": f"Contents of {path}:\n{preview}" + ("…[truncated]" if len(content) > 3000 else ""),
        }
    except FileNotFoundError:
        return {"success": False, "error": "Not found", "message": f'File "{path}" does not exist.'}
    except Exception as exc:
        return {"success": False, "error": "Read failed", "message": f"Could not read file: {type(exc).__name__}"}


async def create_file(path: str, content: str) -> Dict[str, Any]:
    """Create or overwrite a non-protected text file within the project directory."""
    safe = safe_workspace_path(path, for_write=True)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Write access to this path or file type is restricted."}

    def _write():
        safe.parent.mkdir(parents=True, exist_ok=True)
        safe.write_text(content, encoding="utf-8")

    try:
        await asyncio.to_thread(_write)
        return {"success": True, "data": {"path": str(safe.relative_to(_PROJECT_ROOT.resolve()))}, "message": f'Created file "{path}".'}
    except Exception as exc:
        return {"success": False, "error": "Write failed", "message": f"Could not create file: {type(exc).__name__}"}


async def search_files(pattern: str, directory: str = ".") -> Dict[str, Any]:
    """Search for files matching a glob pattern within the project."""
    safe_dir = safe_workspace_path(directory, for_write=False)
    if safe_dir is None:
        return {"success": False, "error": "Access denied", "message": "Directory is restricted or outside the allowed project directory."}

    try:
        matches = await asyncio.to_thread(_search_recursive, safe_dir, pattern)
        rel_matches = [str(Path(m).relative_to(_PROJECT_ROOT.resolve())) for m in matches]
        if not rel_matches:
            return {"success": True, "message": f'No files matching "{pattern}" found in {directory}.'}
        return {
            "success": True,
            "data": rel_matches,
            "message": f"Found {len(rel_matches)} file(s):\n" + "\n".join(f"• {m}" for m in rel_matches[:20]),
        }
    except Exception as exc:
        return {"success": False, "error": "Search failed", "message": f"Search failed: {type(exc).__name__}"}


def _search_recursive(root: Path, pattern: str) -> List[str]:
    results = []
    for p in root.rglob("*"):
        if any(part.startswith(".") or part.lower() in _SKIP_NAMES for part in p.parts):
            continue
        if p.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".key", ".pem", ".cert"}:
            continue
        if fnmatch.fnmatch(p.name, pattern):
            results.append(str(p))
            if len(results) >= 50:
                break
    return results
