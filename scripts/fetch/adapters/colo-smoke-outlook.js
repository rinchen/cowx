/**
 * CDPHE Colorado Smoke Blog (Blogspot RSS) — statewide narrative teaser.
 * Failure point: Blogspot RSS timeout / markup change.
 * Fallback: status error; orchestrator may carry forward prior colo-smoke-outlook.json.
 */

import { fetchWithTimeout, sanitizeErrorMessage, NWS_USER_AGENT } from '../../lib/http.js';

export const COLO_SMOKE_BLOG_URL = 'https://colosmokeoutlook.blogspot.com/';
export const COLO_SMOKE_RSS_URL =
  'https://colosmokeoutlook.blogspot.com/feeds/posts/default?alt=rss';

export const SNIPPET_MAX_CHARS = 500;

/**
 * Decode a few common XML/HTML entities (Blogspot RSS escapes HTML in description).
 * Named entities before `&amp;` so `&amp;quot;` becomes `&quot;`, not `"`.
 * @param {string} raw
 * @returns {string}
 */
export function decodeBasicEntities(raw) {
  return (
    String(raw ?? '')
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
        const code = Number.parseInt(h, 16);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : _;
      })
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      // Unescape ampersand last to avoid double-unescaping (&amp;quot; → &quot;).
      .replace(/&amp;/gi, '&')
  );
}

/**
 * Strip HTML to plain text for a short teaser (never store full post HTML).
 * @param {string} htmlOrText
 * @param {number} [maxChars]
 * @returns {string}
 */
export function htmlToSnippet(htmlOrText, maxChars = SNIPPET_MAX_CHARS) {
  let s = String(htmlOrText ?? '');
  // Blogspot often double-escapes: &lt;p&gt;… — decode once so tags can be stripped.
  if (/&lt;|&gt;|&amp;/.test(s)) {
    s = decodeBasicEntities(s);
  }
  s = s
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeBasicEntities(s).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[.,;:\s]+$/u, '')}…`;
}

/**
 * Extract text of the first matching element (non-greedy, no nested same-tag).
 * @param {string} xml
 * @param {string} tag
 * @returns {string | null}
 */
function firstTagText(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(xml ?? '').match(re);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

/**
 * Parse Blogspot RSS 2.0 and return the latest post snapshot fields.
 * @param {string} rssXml
 * @returns {{
 *   title: string,
 *   url: string,
 *   publishedAt: string | null,
 *   snippet: string,
 *   guid: string | null,
 * } | null}
 */
export function parseColoSmokeRss(rssXml) {
  const xml = String(rssXml ?? '');
  const itemMatch = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  if (!itemMatch) return null;
  const item = itemMatch[1];

  const titleRaw = firstTagText(item, 'title');
  const title = titleRaw ? decodeBasicEntities(titleRaw).replace(/\s+/g, ' ').trim() : '';
  if (!title) return null;

  let url = firstTagText(item, 'link');
  if (url) url = decodeBasicEntities(url).trim();
  if (!url || !/^https:\/\//i.test(url)) {
    url = COLO_SMOKE_BLOG_URL;
  }

  const pubDateRaw = firstTagText(item, 'pubDate');
  let publishedAt = null;
  if (pubDateRaw) {
    const ms = Date.parse(pubDateRaw);
    if (Number.isFinite(ms)) publishedAt = new Date(ms).toISOString();
  }

  const guidRaw = firstTagText(item, 'guid');
  const guid = guidRaw ? decodeBasicEntities(guidRaw).trim() || null : null;

  const descriptionRaw = firstTagText(item, 'description') ?? '';
  const snippet = htmlToSnippet(descriptionRaw);

  return { title, url, publishedAt, snippet, guid };
}

/**
 * Build the public colo-smoke-outlook.json snapshot.
 * @param {{
 *   title: string,
 *   url: string,
 *   publishedAt: string | null,
 *   snippet: string,
 *   guid?: string | null,
 *   fetchedAt?: string,
 * }} post
 */
export function buildColoSmokeOutlookSnapshot(post) {
  return {
    generatedAt: post.fetchedAt ?? new Date().toISOString(),
    title: post.title,
    publishedAt: post.publishedAt,
    url: post.url,
    snippet: post.snippet,
    guid: post.guid ?? null,
    source: {
      name: 'CDPHE Colorado Smoke Blog',
      homeUrl: COLO_SMOKE_BLOG_URL,
      feedUrl: COLO_SMOKE_RSS_URL,
    },
  };
}

/**
 * @returns {Promise<{
 *   status: 'ok' | 'error',
 *   bySlug: Map<string, unknown>,
 *   snapshot: object | null,
 *   calls: number,
 *   error?: string,
 * }>}
 */
export async function fetchColoSmokeOutlook() {
  let calls = 0;
  try {
    calls += 1;
    const res = await fetchWithTimeout(COLO_SMOKE_RSS_URL, {
      timeoutMs: 25_000,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': NWS_USER_AGENT,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        status: 'error',
        bySlug: new Map(),
        snapshot: null,
        calls,
        error: sanitizeErrorMessage(`HTTP ${res.status} for Colo Smoke RSS: ${body.slice(0, 120)}`),
      };
    }
    const xml = await res.text();
    const post = parseColoSmokeRss(xml);
    if (!post) {
      return {
        status: 'error',
        bySlug: new Map(),
        snapshot: null,
        calls,
        error: 'Colo Smoke RSS: no usable latest item',
      };
    }
    const snapshot = buildColoSmokeOutlookSnapshot({
      ...post,
      fetchedAt: new Date().toISOString(),
    });
    return {
      status: 'ok',
      bySlug: new Map(),
      snapshot,
      calls,
    };
  } catch (err) {
    return {
      status: 'error',
      bySlug: new Map(),
      snapshot: null,
      calls,
      error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    };
  }
}
