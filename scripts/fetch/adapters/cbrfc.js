/**
 * NOAA CBRFC seasonal water-supply / ESP model guidance for Colorado points.
 * Failure point: espcond_data.py timeout / schema change.
 * Fallback: status error; cbrfc null for all locations; never abort the job.
 *
 * Values are unregulated seasonal volume guidance (percent of average), not
 * deterministic streamflow forecasts. Frame as guidance in the UI.
 */

import { fetchJson, sanitizeErrorMessage } from '../../lib/http.js';
import { haversineKm } from '../../lib/geo.js';
import { toFiniteNumber } from '../../lib/parse.js';

const MAX_DISTANCE_KM = 60;
const SOURCE_URL = 'https://www.cbrfc.noaa.gov/dbdata/station/espgraph/list/esplist.html';
const DATA_URL =
  'https://www.cbrfc.noaa.gov/wsup/graph/espcond_data.py?fdate=LATEST&area=CB&sort=basin&otype=json&qpfdays=0';
const DISCLAIMER =
  'CBRFC water-supply values are unregulated seasonal volume guidance (percent of average), not a day-to-day streamflow forecast. Verify on the CBRFC site.';

/**
 * Parse columnar espcond_data.py JSON into point records (Colorado only).
 * @param {unknown} raw
 * @returns {{
 *   id: string,
 *   name: string,
 *   river: string | null,
 *   location: string | null,
 *   lat: number,
 *   lon: number,
 *   forecastDate: string | null,
 *   period: string | null,
 *   pctAvg: number | null,
 *   pctMed: number | null,
 *   percentile: number | null,
 *   mostProbableKaf: number | null,
 *   avgKaf: number | null,
 * }[]}
 */
export function parseCbrfcEspJson(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const d = /** @type {Record<string, unknown>} */ (raw);
  const ids = Array.isArray(d.espid) ? d.espid : [];
  if (!ids.length) return [];

  /** @type {ReturnType<typeof parseCbrfcEspJson>} */
  const out = [];
  for (let i = 0; i < ids.length; i += 1) {
    const state = Array.isArray(d.espstate) ? String(d.espstate[i] ?? '') : '';
    if (state !== 'CO') continue;
    const lat = toFiniteNumber(Array.isArray(d.esplatdd) ? d.esplatdd[i] : null);
    const lon = toFiniteNumber(Array.isArray(d.esplngdd) ? d.esplngdd[i] : null);
    if (lat == null || lon == null) continue;
    const id = String(ids[i] ?? '').trim();
    if (!id) continue;
    const name = Array.isArray(d.espname) ? String(d.espname[i] ?? '').trim() : '';
    out.push({
      id,
      name: name || id,
      river: Array.isArray(d.espriver) ? String(d.espriver[i] ?? '').trim() || null : null,
      location: Array.isArray(d.espname2) ? String(d.espname2[i] ?? '').trim() || null : null,
      lat,
      lon,
      forecastDate: Array.isArray(d.espfdate) ? String(d.espfdate[i] ?? '').trim() || null : null,
      period: Array.isArray(d.espperstr) ? String(d.espperstr[i] ?? '').trim() || null : null,
      pctAvg: toFiniteNumber(Array.isArray(d.esppavg) ? d.esppavg[i] : null),
      pctMed: toFiniteNumber(Array.isArray(d.esppmed) ? d.esppmed[i] : null),
      percentile: toFiniteNumber(Array.isArray(d.esppctile) ? d.esppctile[i] : null),
      mostProbableKaf: toFiniteNumber(Array.isArray(d.espp_500) ? d.espp_500[i] : null),
      avgKaf: toFiniteNumber(Array.isArray(d.espavg30) ? d.espavg30[i] : null),
    });
  }
  return out;
}

/**
 * Nearest CBRFC CO point within maxKm.
 * @param {{ lat: number, lon: number }} target
 * @param {ReturnType<typeof parseCbrfcEspJson>} points
 * @param {number} [maxKm]
 */
export function nearestCbrfcPoint(target, points, maxKm = MAX_DISTANCE_KM) {
  let best = null;
  let bestKm = Infinity;
  for (const p of points) {
    const km = haversineKm(target, p);
    if (km < bestKm) {
      bestKm = km;
      best = p;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return {
    id: best.id,
    name: best.name,
    river: best.river,
    location: best.location,
    lat: best.lat,
    lon: best.lon,
    distance_km: Math.round(bestKm * 10) / 10,
    forecastDate: best.forecastDate,
    period: best.period,
    pctAvg: best.pctAvg,
    pctMed: best.pctMed,
    percentile: best.percentile,
    mostProbableKaf: best.mostProbableKaf,
    avgKaf: best.avgKaf,
    sourceUrl: SOURCE_URL,
    pointUrl: `https://www.cbrfc.noaa.gov/wsup/graph/espgraph_hc.html?id=${encodeURIComponent(best.id)}`,
    disclaimer: DISCLAIMER,
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchCbrfc(locations) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;

  try {
    const raw = await fetchJson(DATA_URL, { timeoutMs: 60_000 });
    calls += 1;
    const points = parseCbrfcEspJson(raw);
    if (!points.length) {
      for (const loc of locations) bySlug.set(loc.slug, null);
      return {
        status: 'error',
        bySlug,
        calls,
        error: 'CBRFC ESP JSON contained no Colorado points',
      };
    }

    let matched = 0;
    for (const loc of locations) {
      const nearest = nearestCbrfcPoint(loc, points);
      bySlug.set(loc.slug, nearest);
      if (nearest) matched += 1;
    }

    return {
      status: matched > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
      ...(matched === 0 ? { error: 'No catalog locations within range of a CBRFC CO point' } : {}),
    };
  } catch (err) {
    calls += 1;
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'error',
      bySlug,
      calls,
      error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }
}
