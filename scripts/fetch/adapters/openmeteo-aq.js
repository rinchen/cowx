/**
 * Open-Meteo Air Quality — PM2.5 / European AQI style fields.
 */

import { fetchJson, sleep } from '../../lib/http.js';

const CHUNK = 40;
const RETRY_CHUNK = 20;
const DELAY_MS = 8000;
const RETRY_BACKOFF_MS = 60_000;
const SHORT_BACKOFF_MS = 5000;

/**
 * Map one Open-Meteo air-quality `current` block onto payload fields.
 * @param {Record<string, unknown> | null | undefined} cur
 * @returns {object | null}
 */
export function mapOpenMeteoAqCurrent(cur) {
  if (!cur || typeof cur !== 'object') return null;
  return {
    pm25: cur.pm2_5 ?? null,
    pm10: cur.pm10 ?? null,
    co: cur.carbon_monoxide ?? null,
    no2: cur.nitrogen_dioxide ?? null,
    so2: cur.sulphur_dioxide ?? null,
    o3: cur.ozone ?? null,
    european_aqi: cur.european_aqi ?? null,
    us_aqi: cur.us_aqi ?? null,
    time: cur.time ?? null,
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 * @returns {string}
 */
function buildUrl(chunk) {
  const lats = chunk.map((l) => l.lat).join(',');
  const lons = chunk.map((l) => l.lon).join(',');
  return (
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}` +
    `&current=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,european_aqi,us_aqi&timezone=America%2FDenver`
  );
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 * @param {Map<string, object>} bySlug
 * @param {string[]} errors
 * @param {{ rateLimitDelayMs: number, shortBackoffMs: number }} delays
 * @returns {Promise<number>} API calls made
 */
async function fetchChunk(chunk, bySlug, errors, delays) {
  try {
    const data = await fetchJson(buildUrl(chunk), { timeoutMs: 60_000 });
    const results = Array.isArray(data) ? data : [data];
    for (let j = 0; j < chunk.length; j += 1) {
      const loc = chunk[j];
      const r = results[j];
      const mapped = mapOpenMeteoAqCurrent(r?.current);
      if (!mapped) continue;
      bySlug.set(loc.slug, mapped);
    }
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    if (msg.includes('429')) await sleep(delays.rateLimitDelayMs);
    else await sleep(delays.shortBackoffMs);
    return 1;
  }
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{
 *   delayMs?: number,
 *   rateLimitDelayMs?: number,
 *   retryBackoffMs?: number,
 *   shortBackoffMs?: number,
 * }} [opts]
 */
export async function fetchOpenMeteoAq(locations, opts = {}) {
  const delayMs = opts.delayMs ?? DELAY_MS;
  const rateLimitDelayMs = opts.rateLimitDelayMs ?? RETRY_BACKOFF_MS;
  const retryBackoffMs = opts.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const shortBackoffMs = opts.shortBackoffMs ?? SHORT_BACKOFF_MS;
  const delays = { rateLimitDelayMs, shortBackoffMs };
  const bySlug = new Map();
  let calls = 0;
  const errors = [];

  for (let i = 0; i < locations.length; i += CHUNK) {
    if (i > 0) await sleep(delayMs);
    const chunk = locations.slice(i, i + CHUNK);
    calls += await fetchChunk(chunk, bySlug, errors, delays);
  }

  const missing = locations.filter((l) => !bySlug.has(l.slug));
  if (missing.length > 0) {
    console.warn(`openmeteo_aq: retrying ${missing.length} missing locations after backoff`);
    await sleep(retryBackoffMs);
    for (let i = 0; i < missing.length; i += RETRY_CHUNK) {
      if (i > 0) await sleep(delayMs);
      const chunk = missing.slice(i, i + RETRY_CHUNK);
      calls += await fetchChunk(chunk, bySlug, errors, delays);
    }
  }

  if (bySlug.size === 0) {
    return { status: 'error', bySlug, error: errors.join('; ') || 'no data', calls };
  }
  const coverage = bySlug.size / Math.max(locations.length, 1);
  if (coverage < 0.9 || bySlug.size < locations.length) {
    return {
      status: 'partial',
      bySlug,
      error: errors.join('; ') || `coverage ${(coverage * 100).toFixed(1)}%`,
      calls,
    };
  }
  return { status: 'ok', bySlug, calls };
}
