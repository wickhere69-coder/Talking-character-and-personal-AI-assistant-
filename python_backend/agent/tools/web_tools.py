"""Web search and fetch tools using DuckDuckGo and Wikipedia (free, no key needed)."""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List

import httpx

from utils.logger import get_logger

logger = get_logger(__name__)

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
                news_url = (
                    "https://news.google.com/rss/search?q="
                    + httpx.URL(query).__str__().replace(query, "")
                )
                news_url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
                r = await client.get(news_url, timeout=3.0)
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
                ddg_url = f"https://html.duckduckgo.com/html/?q={query}"
                r = await client.get(ddg_url, timeout=3.0)
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
                    f"https://api.duckduckgo.com/?q={query}&format=json", timeout=2.5
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
    """Fetch and clean text from a public web URL."""
    if not (url.startswith("http://") or url.startswith("https://")):
        return {"success": False, "error": "Invalid URL", "message": "URL must start with http:// or https://"}

    try:
        async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True, timeout=6.0) as client:
            r = await client.get(url)
            raw = r.text if isinstance(r.text, str) else str(r.content)

            # Strip scripts and styles
            raw = re.sub(r"<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<[^>]+>", " ", raw)
            raw = re.sub(r"\s+", " ", raw).strip()

            preview = raw[:600]
            return {
                "success": True,
                "data": preview,
                "message": f"Fetched webpage content from {url}:\n{preview}...",
            }
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        return {"success": False, "error": str(exc), "message": f"Could not fetch webpage: {exc}"}
