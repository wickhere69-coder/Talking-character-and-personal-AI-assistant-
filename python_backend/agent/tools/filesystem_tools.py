"""Filesystem tools — sandboxed to the project directory."""
from __future__ import annotations

import asyncio
import fnmatch
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

# Security boundary: only allow access within the project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # talking-character-app/


def _safe_path(requested: str) -> Optional[Path]:
    """Resolve the requested path; return None if it escapes the project root."""
    try:
        resolved = (_PROJECT_ROOT / requested).resolve()
        # Ensure it's within the project root
        resolved.relative_to(_PROJECT_ROOT)
        return resolved
    except (ValueError, OSError):
        return None


async def list_files(path: str = ".") -> Dict[str, Any]:
    """List files in a directory within the project."""
    safe = _safe_path(path)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Path is outside the allowed project directory."}

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
        return {"success": False, "error": str(exc), "message": f"Could not list directory: {exc}"}


def _list_dir(p: Path) -> List[str]:
    entries = []
    for item in sorted(p.iterdir()):
        if item.name.startswith(".") or item.name == "node_modules":
            continue
        suffix = "/" if item.is_dir() else ""
        entries.append(item.name + suffix)
    return entries


async def read_file(path: str) -> Dict[str, Any]:
    """Read a file's contents within the project."""
    safe = _safe_path(path)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Path is outside the allowed project directory."}

    try:
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
        return {"success": False, "error": str(exc), "message": f"Could not read file: {exc}"}


async def create_file(path: str, content: str) -> Dict[str, Any]:
    """Create or overwrite a file within the project directory."""
    safe = _safe_path(path)
    if safe is None:
        return {"success": False, "error": "Access denied", "message": "Path is outside the allowed project directory."}

    def _write():
        safe.parent.mkdir(parents=True, exist_ok=True)
        safe.write_text(content, encoding="utf-8")

    try:
        await asyncio.to_thread(_write)
        return {"success": True, "data": {"path": str(safe.relative_to(_PROJECT_ROOT))}, "message": f'Created file "{path}".'}
    except Exception as exc:
        return {"success": False, "error": str(exc), "message": f"Could not create file: {exc}"}


async def search_files(pattern: str, directory: str = ".") -> Dict[str, Any]:
    """Search for files matching a glob pattern within the project."""
    safe_dir = _safe_path(directory)
    if safe_dir is None:
        return {"success": False, "error": "Access denied", "message": "Directory is outside the allowed project directory."}

    try:
        matches = await asyncio.to_thread(_search_recursive, safe_dir, pattern)
        rel_matches = [str(Path(m).relative_to(_PROJECT_ROOT)) for m in matches]
        if not rel_matches:
            return {"success": True, "message": f'No files matching "{pattern}" found in {directory}.'}
        return {
            "success": True,
            "data": rel_matches,
            "message": f"Found {len(rel_matches)} file(s):\n" + "\n".join(f"• {m}" for m in rel_matches[:20]),
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "message": f"Search failed: {exc}"}


def _search_recursive(root: Path, pattern: str) -> List[str]:
    results = []
    for p in root.rglob("*"):
        if any(part.startswith(".") or part == "node_modules" for part in p.parts):
            continue
        if fnmatch.fnmatch(p.name, pattern):
            results.append(str(p))
            if len(results) >= 50:
                break
    return results
