"""Web search and fetch tools using DuckDuckGo and Wikipedia (free, no key needed)."""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List
from urllib.parse import urljoin

import httpx

from utils.logger import get_logger
from utils.security import sanitize_error_message, validate_public_http_url

logger = get_logger(__name__)
_MAX_WEBPAGE_BYTES = 524_288  # 512 KB cap to prevent OOM on large responses
_MAX_REDIRECTS = 3

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _decode_html(html: str) -> str:
    """Strip HTML tags and decode common HTML entities."""
    replacements = [
        ("&#x27;", "'"), ("&#39;", "'"), ("&quot;", '"'),
        ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
        ("&#8217;", "'"), ("&#8220;", '"'), ("&#8221;", '"'),
    ]
    for entity, char in replacements:
        html = html.replace(entity, char)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"\s+", " ", html).strip()
    return html


async def web_search(query: str) -> Dict[str, Any]:
    """Search the web for live information. Uses Google News RSS, DuckDuckGo HTML,
    DuckDuckGo Instant Answer API, and Wikipedia as fallbacks.

    Returns dict with keys: success, message, data (list of snippets).
    """
    query = (query or "").strip()
    if not query:
        return {"success": False, "error": "Query cannot be empty", "message": "No search query provided."}

    snippets: List[str] = []

    is_news = bool(re.search(
        r"\b(news|today|latest|current|recent|election|war|game|super bowl|score|winner|"
        r"championship|president|minister|stock|price|what happened|who won)\b",
        query, re.IGNORECASE
    ))

    async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True, timeout=5.0) as client:
        # 1. Google News RSS for current events
        if is_news and len(snippets) < 4:
            try:
                r = await client.get(
                    "https://news.google.com/rss/search",
                    params={"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"},
                    timeout=3.0,
                )
                if r.status_code == 200:
                    xml = r.text
                    item_pattern = re.compile(
                        r"<item>[\s\S]*?<title>([\s\S]*?)</title>[\s\S]*?<pubDate>([\s\S]*?)</pubDate>[\s\S]*?</item>"
                    )
                    for m in item_pattern.finditer(xml):
                        if len(snippets) >= 4:
                            break
                        title = _decode_html(m.group(1).replace("<![CDATA[", "").replace("]]>", "").strip())
                        pub_date = m.group(2).strip()
                        if title and not title.lower().startswith("google news"):
                            snippets.append(f"{title} (Reported: {pub_date})")
            except Exception:
                pass

        # 2. DuckDuckGo HTML search
        if len(snippets) < 3:
            try:
                r = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                    timeout=3.0,
                )
                if r.status_code == 200:
                    html = r.text
                    for m in re.finditer(r'class="result__snippet[^"]*"[^>]*>([\s\S]*?)</a>', html):
                        if len(snippets) >= 4:
                            break
                        cleaned = _decode_html(m.group(1))
                        if len(cleaned) > 20:
                            snippets.append(cleaned)
            except Exception:
                pass

        # 3. DuckDuckGo Instant Answer API
        if len(snippets) < 2:
            try:
                r = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json"},
                    timeout=2.5,
                )
                if r.status_code == 200:
                    data = r.json()
                    abstract = data.get("AbstractText", "")
                    if abstract:
                        snippets.append(abstract)
            except Exception:
                pass

        # 4. Wikipedia fallback
        if len(snippets) == 0:
            try:
                r = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "query",
                        "list": "search",
                        "srsearch": query,
                        "format": "json",
                        "utf8": 1,
                        "srlimit": 3,
                    },
                    headers={"User-Agent": "StudioPersonalAssistant/1.0 (personal.agent@local)"},
                    timeout=2.5,
                )
                if r.status_code == 200:
                    items = r.json().get("query", {}).get("search", [])
                    for item in items:
                        snippets.append(f"{item['title']}: {_decode_html(item.get('snippet', ''))}")
            except Exception:
                pass

    if snippets:
        formatted = "\n\n".join(f"[{i+1}] {s}" for i, s in enumerate(snippets))
        return {
            "success": True,
            "data": snippets,
            "message": f'Real-time live search results for "{query}":\n{formatted}',
        }

    return {"success": True, "message": f'No search results found for "{query}".'}


async def fetch_webpage(url: str) -> Dict[str, Any]:
    """Fetch and clean text from a validated public web URL (with SSRF protection)."""
    try:
        current_url = await asyncio.to_thread(validate_public_http_url, url)
    except ValueError as val_err:
        return {"success": False, "error": "Restricted URL", "message": str(val_err)}

    try:
        async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=False, timeout=6.0) as client:
            resp = None
            for _ in range(_MAX_REDIRECTS + 1):
                async with client.stream("GET", current_url) as r:
                    if r.is_redirect and "location" in r.headers:
                        next_url = urljoin(current_url, r.headers["location"])
                        current_url = await asyncio.to_thread(validate_public_http_url, next_url)
                        continue

                    chunks: List[bytes] = []
                    total = 0
                    async for chunk in r.aiter_bytes():
                        chunks.append(chunk)
                        total += len(chunk)
                        if total >= _MAX_WEBPAGE_BYTES:
                            break
                    raw = b"".join(chunks).decode("utf-8", errors="replace")
                    resp = r
                    break

            if resp is None:
                return {"success": False, "error": "Too many redirects", "message": "Too many redirects while fetching webpage."}

            # Strip scripts and styles
            raw = re.sub(r"<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<[^>]+>", " ", raw)
            raw = re.sub(r"\s+", " ", raw).strip()

            preview = raw[:600]
            return {
                "success": True,
                "data": preview,
                "message": f"Fetched webpage content from {current_url}:\n{preview}...",
            }
    except asyncio.CancelledError:
        raise
    except ValueError as val_err:
        return {"success": False, "error": "Restricted redirect", "message": str(val_err)}
    except Exception as exc:
        safe_msg = sanitize_error_message(exc, "Failed to fetch webpage.")
        return {"success": False, "error": safe_msg, "message": f"Could not fetch webpage: {safe_msg}"}
