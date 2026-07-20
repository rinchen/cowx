/**
 * Colorado burn / fire restriction status + curated verification links.
 * Failure point: COEM HTML fetch/parse failure.
 * Fallback: status unknown + curated county/statewide links; never invent Stage 1/2.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout } from '../../lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINKS_PATH = path.resolve(__dirname, '../../locations/co-fire-restriction-links.json');

const COEM_URL = 'http://www.coemergency.com/p/fire-bans-danger.html';

const DISCLAIMER = 'Verify with local sheriff / land manager before burning or campfires.';

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
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{ fetchHtml?: () => Promise<string>, linksPath?: string }} [opts]
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
  let parseOk = false;

  try {
    let html;
    if (opts.fetchHtml) {
      html = await opts.fetchHtml();
    } else {
      const res = await fetchWithTimeout(COEM_URL, { timeoutMs: 45_000 });
      calls += 1;
      if (!res.ok) throw new Error(`HTTP ${res.status} for COEM fire bans page`);
      html = await res.text();
    }
    statusByCounty = parseCoemRestrictionHtml(html);
    if (statusByCounty.size > 0) {
      parseOk = true;
      updatedAt = new Date().toISOString();
    } else {
      errors.push('COEM parse returned no counties');
    }
  } catch (err) {
    if (!opts.fetchHtml) calls += 1;
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const loc of locations) {
    bySlug.set(loc.slug, buildRestrictionForLocation(loc, statusByCounty, links, updatedAt));
  }

  if (!parseOk && Object.keys(links.counties).length === 0 && links.statewide.length === 0) {
    return {
      status: 'error',
      bySlug,
      calls,
      error: (errors.join('; ') || 'Burn restriction data unavailable').slice(0, 500),
    };
  }

  return {
    status: parseOk ? (errors.length ? 'partial' : 'ok') : 'partial',
    bySlug,
    calls,
    ...(errors.length ? { error: errors.join('; ').slice(0, 500) } : {}),
  };
}
