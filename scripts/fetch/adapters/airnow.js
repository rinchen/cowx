/**
 * AirNow observations — grid-deduped lat/lon then nearest-assign to all locations.
 * Failure point: missing key, rate limits.
 * Fallback: skipped/error/partial.
 */

import { fetchJson, sleep } from '../../lib/http.js';
import { assignNearestWithin, roundKm } from '../../lib/geo.js';

const GRID = 0.2;
const DELAY_MS = 350;

/**
 * @param {number} n
 * @param {number} step
 */
function roundGrid(n, step) {
  return Math.round(n / step) * step;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{ AIRNOW_API_KEY?: string }} env
 */
export async function fetchAirNow(locations, env = process.env) {
  const bySlug = new Map();
  let calls = 0;
  const key = env.AIRNOW_API_KEY;
  if (!key) {
    return { status: 'skipped', bySlug, calls, error: 'AIRNOW_API_KEY not set' };
  }

  /** @type {Map<string, { lat: number, lon: number }>} */
  const gridPoints = new Map();
  for (const loc of locations) {
    const gLat = roundGrid(loc.lat, GRID);
    const gLon = roundGrid(loc.lon, GRID);
    const gk = `${gLat.toFixed(2)},${gLon.toFixed(2)}`;
    if (!gridPoints.has(gk)) {
      gridPoints.set(gk, { lat: gLat, lon: gLon });
    }
  }

  /** @type {Array<{ lat: number, lon: number, payload: object }>} */
  const samples = [];
  const errors = [];

  let i = 0;
  for (const point of gridPoints.values()) {
    if (i > 0) await sleep(DELAY_MS);
    i += 1;
    try {
      calls += 1;
      const url =
        `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json` +
        `&latitude=${point.lat}&longitude=${point.lon}&distance=50&API_KEY=${encodeURIComponent(key)}`;
      const data = await fetchJson(url, { timeoutMs: 20_000 });
      if (!Array.isArray(data) || data.length === 0) continue;

      const byParam = {};
      for (const row of data) {
        byParam[row.ParameterName] = {
          aqi: row.AQI,
          category: row.Category?.Name ?? null,
          reporting_area: row.ReportingArea,
          observed: `${row.DateObserved} ${row.HourObserved}`,
        };
      }
      const overall = data.reduce(
        (best, row) => (best == null || (row.AQI ?? 0) > (best.AQI ?? 0) ? row : best),
        null,
      );

      samples.push({
        lat: point.lat,
        lon: point.lon,
        payload: {
          aqi: overall?.AQI ?? null,
          category: overall?.Category?.Name ?? null,
          parameter: overall?.ParameterName ?? null,
          reporting_area: overall?.ReportingArea ?? null,
          observed: overall ? `${overall.DateObserved} ${overall.HourObserved}` : null,
          by_parameter: byParam,
          url: 'https://www.airnow.gov/',
        },
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (samples.length === 0) {
    return {
      status: errors.length ? 'error' : 'partial',
      bySlug,
      error: errors.slice(0, 5).join('; ') || 'no AirNow observations',
      calls,
    };
  }

  const assigned = assignNearestWithin(locations, samples, 80, (nearest) => ({
    ...nearest.point.payload,
    distance_km: roundKm(nearest.distanceKm),
  }));
  for (const [slug, row] of assigned) bySlug.set(slug, row);

  const status =
    errors.length || bySlug.size < locations.length * 0.7
      ? 'partial'
      : bySlug.size
        ? 'ok'
        : 'partial';

  return {
    status,
    bySlug,
    error: errors.length ? errors.slice(0, 5).join('; ') : undefined,
    calls,
  };
}
