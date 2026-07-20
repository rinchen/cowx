/**
 * PurpleAir CO bounding-box sensors → nearest per location.
 * Failure point: missing key, point exhaustion, HTTP errors.
 * Fallback: status skipped/error; UI uses offsite links.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

// Rough Colorado bbox
const NWLAT = 41.0;
const SELAT = 37.0;
const NWLNG = -109.1;
const SELNG = -102.0;

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{ PURPLEAIR_API_KEY?: string }} env
 */
export async function fetchPurpleAir(locations, env = process.env) {
  const bySlug = new Map();
  let calls = 0;
  const key = env.PURPLEAIR_API_KEY;
  if (!key) {
    return { status: 'skipped', bySlug, calls, error: 'PURPLEAIR_API_KEY not set' };
  }

  try {
    calls += 1;
    const fields = 'name,latitude,longitude,pm2.5_10minute,humidity,temperature';
    const url =
      `https://api.purpleair.com/v1/sensors?fields=${encodeURIComponent(fields)}` +
      `&nwlat=${NWLAT}&selat=${SELAT}&nwlng=${NWLNG}&selng=${SELNG}&max_age=3600`;

    const data = await fetchJson(url, {
      headers: { 'X-API-Key': key },
      timeoutMs: 60_000,
    });

    const fieldNames = data?.fields ?? [];
    const rows = data?.data ?? [];
    const sensors = rows
      .map((row) => {
        const obj = {};
        for (let i = 0; i < fieldNames.length; i += 1) {
          obj[fieldNames[i]] = row[i];
        }
        const lat = Number(obj.latitude);
        const lon = Number(obj.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          lat,
          lon,
          name: obj.name ?? 'PurpleAir',
          pm25: obj['pm2.5_10minute'] != null ? Number(obj['pm2.5_10minute']) : null,
          humidity: obj.humidity != null ? Number(obj.humidity) : null,
          temperature_f: obj.temperature != null ? Number(obj.temperature) : null,
        };
      })
      .filter(Boolean);

    for (const loc of locations) {
      const n = nearestPoint({ lat: loc.lat, lon: loc.lon }, sensors);
      if (!n || n.distanceKm > 25) continue;
      const s = n.point;
      bySlug.set(loc.slug, {
        name: s.name,
        distance_km: Math.round(n.distanceKm * 10) / 10,
        pm25: s.pm25,
        humidity: s.humidity,
        temperature_f: s.temperature_f,
        aqi_pm25: pm25ToAqi(s.pm25),
        url: 'https://map.purpleair.com/',
      });
    }

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
    };
  } catch (err) {
    return {
      status: 'error',
      bySlug,
      error: err instanceof Error ? err.message : String(err),
      calls,
    };
  }
}

/**
 * EPA PM2.5 → AQI (NowCast-style breakpoints).
 * @param {number|null} pm
 * @returns {number|null}
 */
export function pm25ToAqi(pm) {
  if (pm == null || !Number.isFinite(pm)) return null;
  const breakpoints = [
    [0, 12, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 500.4, 301, 500],
  ];
  for (const [cLow, cHigh, aLow, aHigh] of breakpoints) {
    if (pm >= cLow && pm <= cHigh) {
      return Math.round(((aHigh - aLow) / (cHigh - cLow)) * (pm - cLow) + aLow);
    }
  }
  return 500;
}
