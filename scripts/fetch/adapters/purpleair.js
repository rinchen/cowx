/**
 * PurpleAir CO bounding-box sensors → nearest per location.
 * Failure point: missing key, point exhaustion, HTTP errors.
 * Fallback: status skipped/error; UI uses offsite links.
 */

import { fetchJson } from '../../lib/http.js';
import { assignNearestWithin, roundKm } from '../../lib/geo.js';
import { CO_BBOX } from '../../lib/colorado.js';
import { toFiniteNumber } from '../../lib/parse.js';

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
      `&nwlat=${CO_BBOX.north}&selat=${CO_BBOX.south}&nwlng=${CO_BBOX.west}&selng=${CO_BBOX.east}&max_age=3600`;

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
        const lat = toFiniteNumber(obj.latitude);
        const lon = toFiniteNumber(obj.longitude);
        if (lat == null || lon == null) return null;
        return {
          lat,
          lon,
          name: obj.name ?? 'PurpleAir',
          pm25: toFiniteNumber(obj['pm2.5_10minute']),
          humidity: toFiniteNumber(obj.humidity),
          temperature_f: toFiniteNumber(obj.temperature),
        };
      })
      .filter(Boolean);

    const assigned = assignNearestWithin(locations, sensors, 25, (nearest) => {
      const s = nearest.point;
      return {
        name: s.name,
        distance_km: roundKm(nearest.distanceKm),
        pm25: s.pm25,
        humidity: s.humidity,
        temperature_f: s.temperature_f,
        aqi_pm25: pm25ToAqi(s.pm25),
        url: 'https://map.purpleair.com/',
      };
    });
    for (const [slug, row] of assigned) bySlug.set(slug, row);

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
