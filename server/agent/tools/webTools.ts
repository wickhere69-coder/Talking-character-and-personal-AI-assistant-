import axios from 'axios';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

export function registerWebTools(registry: ToolRegistry): void {
  // Helper to decode HTML entities
  const decodeHtml = (html: string) => {
    return html
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 1. web_search (Live real-time search using DuckDuckGo HTML + Wikipedia fallback)
  registry.registerTool(
    {
      name: 'web_search',
      description: 'Search the live web for real-time information, current events, recent news, people, technology, and facts.',
      permission: 'READ_ONLY',
      parameters: {
        query: { type: 'string', description: 'Search query or question', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const query = (params.query || '').trim();
      if (!query) {
        return { success: false, error: 'Query cannot be empty', message: 'No search query provided.' };
      }

      try {
        const snippets: string[] = [];

        // 1. Primary for news & current affairs: Google News RSS (real-time 2026 reporting in ~500ms)
        const isNews = /\b(news|today|latest|current|recent|election|war|game|super bowl|score|winner|championship|president|minister|stock|price|what happened|who won)\b/i.test(query);
        if (isNews) {
          try {
            const newsUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
            const newsRes = await axios.get(newsUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              timeout: 3000
            });
            const xml = newsRes.data || '';
            const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(xml)) !== null && snippets.length < 4) {
              const title = decodeHtml(itemMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
              const pubDate = itemMatch[2].trim();
              if (title && !title.toLowerCase().startsWith('google news')) {
                snippets.push(`${title} (Reported: ${pubDate})`);
              }
            }
          } catch {}
        }

        // 2. DuckDuckGo HTML web search
        if (snippets.length < 3) {
          try {
            const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
            const ddgRes = await fetch(ddgUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              },
              signal: AbortSignal.timeout(3000)
            });
            if (ddgRes.ok) {
              const html = await ddgRes.text();
              const regex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
              let match;
              while ((match = regex.exec(html)) !== null && snippets.length < 4) {
                const cleaned = decodeHtml(match[1]);
                if (cleaned.length > 20) {
                  snippets.push(cleaned);
                }
              }
            }
          } catch {}
        }

        // 3. DuckDuckGo Instant Answer API
        if (snippets.length < 2) {
          try {
            const apiRes = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`, {
              timeout: 2500
            });
            if (apiRes.data?.AbstractText) {
              snippets.push(apiRes.data.AbstractText);
            }
          } catch {}
        }

        // 4. Secondary fallback: Wikipedia API
        if (snippets.length === 0) {
          try {
            const wikiRes = await axios.get(`https://en.wikipedia.org/w/api.php`, {
              headers: { 'User-Agent': 'StudioPersonalAssistant/1.0 (personal.agent@local)' },
              params: { action: 'query', list: 'search', srsearch: query, format: 'json', utf8: 1, srlimit: 3 },
              timeout: 2500
            });
            const items = wikiRes.data?.query?.search || [];
            if (items.length > 0) {
              items.forEach((i: any) => snippets.push(`${i.title}: ${decodeHtml(i.snippet)}`));
            }
          } catch {}
        }

        if (snippets.length > 0) {
          const formatted = snippets.map((s, idx) => `[${idx + 1}] ${s}`).join('\n\n');
          return {
            success: true,
            data: snippets,
            message: `Real-time live search results for "${query}":\n${formatted}`
          };
        }

        return {
          success: true,
          message: `No search results found for "${query}".`
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          message: `Web search temporarily unavailable: ${err.message}`
        };
      }
    }
  );

  // 2. fetch_webpage
  registry.registerTool(
    {
      name: 'fetch_webpage',
      description: 'Fetch and extract clean readable text from a public web URL.',
      permission: 'READ_ONLY',
      parameters: {
        url: { type: 'string', description: 'Web page URL (must start with http:// or https://)', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const url = params.url || '';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'Invalid URL', message: 'URL must start with http:// or https://' };
      }

      try {
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Personal-Assistant/1.0'
          },
          timeout: 6000
        });

        // Strip html tags, scripts, and styles
        let clean = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        clean = clean.replace(/<[^>]+>/g, ' ');
        clean = clean.replace(/\s+/g, ' ').trim();

        const preview = clean.slice(0, 600);
        return {
          success: true,
          data: preview,
          message: `Fetched webpage content from ${url}:\n${preview}...`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: `Could not fetch webpage: ${err.message}` };
      }
    }
  );
}
