/**
 * Colorado burn / fire restriction status + curated verification links.
 * Failure point: COEM HTML fetch/parse failure.
 * Fallback: status unknown + curated county/statewide links; never invent Stage 1/2.
 *
 * Note (2026-07): No single licensed statewide Stage 1/2 JSON exists on
 * data.colorado.gov. Restrictions are issued per county sheriff / land manager;
 * COEM HTML + curated county URLs remain the practical feed. Revisit if DFPC or
 * COEM publish an open GeoJSON/ArcGIS FeatureServer with clear redistribution terms.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout, sleep, NWS_USER_AGENT } from '../../lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINKS_PATH = path.resolve(__dirname, '../../locations/co-fire-restriction-links.json');

// COEM host has no usable HTTPS (TLS handshake fails); Node fetch is fine over HTTP.
const COEM_URL = 'http://www.coemergency.com/p/fire-bans-danger.html';

const DISCLAIMER = 'Verify with local sheriff / land manager before burning or campfires.';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 5_000];
const RETRY_AFTER_CAP_MS = 30_000;

/**
 * @typedef {'restriction_reported' | 'none_reported' | 'unknown'} RestrictionStatus
 */

/**
 * Normalize county name for map lookup.
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeCountyKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+county\b/g, '')
    .replace(/\s+&\s+city\b/g, '')
    .replace(/\s+and\s+city\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse COEM fire-restriction HTML into county → status.
 * Looks for H4 county headings followed by "Fire restrictions reported" /
 * "No fire restrictions reported" (case-insensitive).
 * @param {string} html
 * @returns {Map<string, RestrictionStatus>}
 */
export function parseCoemRestrictionHtml(html) {
  /** @type {Map<string, RestrictionStatus>} */
  const map = new Map();
  const raw = String(html ?? '');

  // Strip tags lightly for text matching across headings.
  // End tags allow optional attrs/whitespace before `>` (browsers accept
  // `</script >` / `</script foo>` even though they are parse errors).
  const text = raw
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '');

  const blocks = text.split(/\n+/);
  let currentCounty = null;

  for (const line of blocks) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;

    const countyMatch = trimmed.match(
      /^([A-Z][A-Za-z .'-]+?)(?:\s+COUNTY(?:\s*(?:&|AND)\s*CITY)?)?\s*$/,
    );
    // COEM uses ALL CAPS headings like "ADAMS COUNTY" or "BOULDER COUNTY & CITY"
    const capsMatch = trimmed.match(
      /^([A-Z][A-Z .'-]+?)(?:\s+COUNTY(?:\s*(?:&|AND)\s*CITY)?)?\s*$/,
    );
    if (
      capsMatch &&
      capsMatch[1].length > 2 &&
      !/FIRE|FEDERAL|TRIBAL|LOCAL|OVERVIEW/.test(capsMatch[1])
    ) {
      const titleCase = capsMatch[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      currentCounty = normalizeCountyKey(titleCase);
      continue;
    }
    if (countyMatch && !/fire|restriction|federal|tribal/i.test(countyMatch[1])) {
      currentCounty = normalizeCountyKey(countyMatch[1]);
      continue;
    }

    if (!currentCounty) continue;

    if (/no\s+(?:local\s+)?fire\s+restrictions?\s+reported/i.test(trimmed)) {
      map.set(currentCounty, 'none_reported');
    } else if (/fire\s+restrictions?\s+reported/i.test(trimmed)) {
      // "Fire restriction reported" (singular) also counts
      if (!map.has(currentCounty) || map.get(currentCounty) === 'unknown') {
        map.set(currentCounty, 'restriction_reported');
      }
    }
  }

  return map;
}

/**
 * @param {string} [linksPath]
 * @returns {Promise<{ counties: Record<string, string>, statewide: { name: string, url: string }[] }>}
 */
export async function loadRestrictionLinks(linksPath = LINKS_PATH) {
  const raw = await readFile(linksPath, 'utf8');
  const data = JSON.parse(raw);
  return {
    counties: data.counties && typeof data.counties === 'object' ? data.counties : {},
    statewide: Array.isArray(data.statewide) ? data.statewide : [],
  };
}

/**
 * Build per-location fire_restrictions payload.
 * @param {import('../../lib/types.js').Location} loc
 * @param {Map<string, RestrictionStatus>} statusByCounty
 * @param {{ counties: Record<string, string>, statewide: { name: string, url: string }[] }} links
 * @param {string | null} updatedAt
 */
export function buildRestrictionForLocation(loc, statusByCounty, links, updatedAt) {
  const county = String(loc.county ?? '');
  const key = normalizeCountyKey(county);
  const status = statusByCounty.get(key) ?? 'unknown';
  const countyUrl = links.counties[county] ?? links.counties[key] ?? null;

  // Also try title-case key from counties object
  let resolvedUrl = countyUrl;
  if (!resolvedUrl) {
    for (const [name, url] of Object.entries(links.counties)) {
      if (normalizeCountyKey(name) === key) {
        resolvedUrl = url;
        break;
      }
    }
  }

  return {
    county,
    status,
    redFlagNote: true,
    countyUrl: resolvedUrl,
    statewideUrls: links.statewide,
    updatedAt,
    disclaimer: DISCLAIMER,
  };
}

/**
 * When COEM scrape fails, keep curated links from the fresh payload but carry
 * forward the last known-good county status (and its updatedAt).
 * @param {object | null | undefined} fresh
 * @param {object | null | undefined} prior
 * @param {boolean} scrapeOk
 * @returns {object | null}
 */
export function mergeFireRestrictions(fresh, prior, scrapeOk) {
  if (!fresh || typeof fresh !== 'object') {
    return prior?.fire_restrictions && typeof prior.fire_restrictions === 'object'
      ? prior.fire_restrictions
      : null;
  }
  if (scrapeOk) return fresh;

  const priorFr = prior?.fire_restrictions;
  const priorStatus = priorFr && typeof priorFr === 'object' ? priorFr.status : null;
  if (priorStatus === 'restriction_reported' || priorStatus === 'none_reported') {
    return {
      ...fresh,
      status: priorStatus,
      updatedAt: priorFr.updatedAt ?? null,
    };
  }
  return fresh;
}

/**
 * @param {Headers | undefined} headers
 * @param {number} attemptIndex zero-based index of the attempt that just failed
 * @returns {number}
 */
function retryDelayMs(headers, attemptIndex) {
  const raw = headers?.get?.('retry-after');
  if (raw != null && raw !== '') {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
    }
  }
  return BACKOFF_MS[Math.min(attemptIndex, BACKOFF_MS.length - 1)];
}

/**
 * Fetch COEM fire-bans HTML with retries on 429/5xx and network errors.
 * On failure, the thrown Error has a numeric `calls` property for meta accounting.
 * @param {{
 *   fetchImpl?: typeof fetchWithTimeout,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<{ html: string, calls: number }>}
 */
export async function fetchCoemHtml(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetchWithTimeout;
  const sleepFn = opts.sleepFn ?? sleep;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  let calls = 0;
  /** @type {Error | null} */
  let lastError = null;

  /**
   * @param {Error} err
   * @returns {never}
   */
  function fail(err) {
    Object.assign(err, { calls });
    throw err;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(COEM_URL, {
        timeoutMs,
        headers: { 'User-Agent': NWS_USER_AGENT },
      });
      calls += 1;
      if (res.ok) {
        return { html: await res.text(), calls };
      }
      lastError = new Error(`HTTP ${res.status} for COEM fire bans page`);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
        fail(lastError);
      }
      await sleepFn(retryDelayMs(res.headers, attempt));
      continue;
    } catch (err) {
      // HTTP path already decided not to retry — rethrow as-is (calls attached).
      if (err === lastError) throw err;

      // Network / abort — count the attempt and retry when attempts remain.
      calls += 1;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_ATTEMPTS - 1) fail(lastError);
      await sleepFn(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }

  fail(lastError ?? new Error('COEM fire bans page unavailable'));
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{
 *   fetchHtml?: () => Promise<string>,
 *   fetchImpl?: typeof fetchWithTimeout,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   linksPath?: string,
 * }} [opts]
 */
export async function fetchBurnRestrictions(locations, opts = {}) {
  /** @type {Map<string, object>} */
  const bySlug = new Map();
  let calls = 0;
  const errors = [];

  let links;
  try {
    links = await loadRestrictionLinks(opts.linksPath);
  } catch (err) {
    links = { counties: {}, statewide: [] };
    errors.push(`links: ${err instanceof Error ? err.message : String(err)}`);
  }

  /** @type {Map<string, RestrictionStatus>} */
  let statusByCounty = new Map();
  /** @type {string | null} */
  let updatedAt = null;
  let scrapeOk = false;

  try {
    let html;
    if (opts.fetchHtml) {
      html = await opts.fetchHtml();
    } else {
      const fetched = await fetchCoemHtml({
        fetchImpl: opts.fetchImpl,
        sleepFn: opts.sleepFn,
      });
      html = fetched.html;
      calls += fetched.calls;
    }
    statusByCounty = parseCoemRestrictionHtml(html);
    if (statusByCounty.size > 0) {
      scrapeOk = true;
      updatedAt = new Date().toISOString();
    } else {
      errors.push('COEM parse returned no counties');
    }
  } catch (err) {
    if (err && typeof err === 'object' && typeof err.calls === 'number') {
      calls += err.calls;
    }
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const loc of locations) {
    bySlug.set(loc.slug, buildRestrictionForLocation(loc, statusByCounty, links, updatedAt));
  }

  if (!scrapeOk && Object.keys(links.counties).length === 0 && links.statewide.length === 0) {
    return {
      status: 'error',
      scrapeOk: false,
      bySlug,
      calls,
      error: (errors.join('; ') || 'Burn restriction data unavailable').slice(0, 500),
    };
  }

  return {
    status: scrapeOk ? (errors.length ? 'partial' : 'ok') : 'partial',
    scrapeOk,
    bySlug,
    calls,
    ...(errors.length ? { error: errors.join('; ').slice(0, 500) } : {}),
  };
}
