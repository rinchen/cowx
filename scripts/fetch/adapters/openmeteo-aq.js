/**
 * Open-Meteo Air Quality — PM2.5 / European AQI style fields.
 */

import { fetchJson } from '../../lib/http.js';

const CHUNK = 40;
const DELAY_MS = 8000;

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchOpenMeteoAq(locations) {
  const bySlug = new Map();
  let calls = 0;
  const errors = [];

  for (let i = 0; i < locations.length; i += CHUNK) {
    if (i > 0) await sleep(DELAY_MS);
    const chunk = locations.slice(i, i + CHUNK);
    const lats = chunk.map((l) => l.lat).join(',');
    const lons = chunk.map((l) => l.lon).join(',');
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}` +
      `&current=pm2_5,european_aqi,us_aqi&timezone=America%2FDenver`;

    try {
      calls += 1;
      const data = await fetchJson(url, { timeoutMs: 60_000 });
      const results = Array.isArray(data) ? data : [data];
      for (let j = 0; j < chunk.length; j += 1) {
        const loc = chunk[j];
        const r = results[j];
        const cur = r?.current;
        if (!cur) continue;
        bySlug.set(loc.slug, {
          pm25: cur.pm2_5 ?? null,
          european_aqi: cur.european_aqi ?? null,
          us_aqi: cur.us_aqi ?? null,
          time: cur.time ?? null,
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      if (String(err).includes('429')) await sleep(60_000);
    }
  }

  if (bySlug.size === 0) {
    return { status: 'error', bySlug, error: errors.join('; ') || 'no data', calls };
  }
  if (errors.length || bySlug.size < locations.length * 0.9) {
    return { status: 'partial', bySlug, error: errors.join('; ') || undefined, calls };
  }
  return { status: 'ok', bySlug, calls };
}
