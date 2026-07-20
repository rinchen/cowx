/**
 * USGS stream gauge adapter — nearest active CO stream within 30 km.
 * Failure point: NWIS IV timeout / empty response.
 * Fallback: status error/partial; location payloads get usgs: null.
 *
 * Uses waterservices IV (latest values by state) — one call for all CO streams.
 * The newer OGC latest-continuous API did not return CO discharge rows reliably.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

const IV_URL =
  'https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=CO&parameterCd=00060,00065,00010&siteStatus=active&siteType=ST';

const MAX_DISTANCE_KM = 30;

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * °C → °F when value looks like Celsius (USGS 00010 is typically °C).
 * @param {number | null} c
 * @returns {number | null}
 */
export function celsiusToFahrenheit(c) {
  if (c == null) return null;
  return Math.round((c * 9) / 5 + 32);
}

/**
 * Parse NWIS IV JSON into gauge records keyed by site number.
 * @param {unknown} data
 * @returns {Map<string, {
 *   station_id: string,
 *   station_name: string,
 *   lat: number,
 *   lon: number,
 *   discharge_cfs: number | null,
 *   gauge_height_ft: number | null,
 *   water_temp_f: number | null,
 *   observed: string | null,
 * }>}
 */
export function parseNwisIv(data) {
  /** @type {Map<string, any>} */
  const bySite = new Map();
  const series =
    /** @type {any} */ (data)?.value?.timeSeries ?? /** @type {any} */ (data)?.timeSeries ?? [];

  if (!Array.isArray(series)) return bySite;

  for (const ts of series) {
    const siteCode = ts?.sourceInfo?.siteCode?.[0]?.value;
    if (!siteCode) continue;
    const lat = num(ts?.sourceInfo?.geoLocation?.geogLocation?.latitude);
    const lon = num(ts?.sourceInfo?.geoLocation?.geogLocation?.longitude);
    if (lat == null || lon == null) continue;

    const param = String(ts?.variable?.variableCode?.[0]?.value ?? '');
    const rawVal = ts?.values?.[0]?.value?.[0];
    const value = num(rawVal?.value);
    const observed = rawVal?.dateTime ? String(rawVal.dateTime) : null;
    const name = String(ts?.sourceInfo?.siteName ?? siteCode);

    let row = bySite.get(siteCode);
    if (!row) {
      row = {
        station_id: String(siteCode),
        station_name: name,
        lat,
        lon,
        discharge_cfs: null,
        gauge_height_ft: null,
        water_temp_f: null,
        observed: null,
      };
      bySite.set(siteCode, row);
    }

    if (param === '00060') row.discharge_cfs = value;
    else if (param === '00065') row.gauge_height_ft = value;
    else if (param === '00010') row.water_temp_f = celsiusToFahrenheit(value);

    if (observed && (!row.observed || observed > row.observed)) {
      row.observed = observed;
    }
    if (name) row.station_name = name;
  }

  return bySite;
}

/**
 * Assign nearest gauge within MAX_DISTANCE_KM to each location.
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {Map<string, any>} gaugesBySite
 * @returns {Map<string, object>}
 */
export function assignNearestGauges(locations, gaugesBySite) {
  const stations = [...gaugesBySite.values()].filter(
    (g) => Number.isFinite(g.lat) && Number.isFinite(g.lon),
  );
  /** @type {Map<string, object>} */
  const bySlug = new Map();

  for (const loc of locations) {
    const nearest = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
    if (!nearest || nearest.distanceKm > MAX_DISTANCE_KM) continue;
    const g = nearest.point;
    bySlug.set(loc.slug, {
      station_id: g.station_id,
      station_name: g.station_name,
      distance_km: Math.round(nearest.distanceKm * 10) / 10,
      discharge_cfs: g.discharge_cfs,
      gauge_height_ft: g.gauge_height_ft,
      water_temp_f: g.water_temp_f,
      observed: g.observed,
      url: `https://waterdata.usgs.gov/nwis/uv?site_no=${encodeURIComponent(String(g.station_id))}`,
    });
  }

  return bySlug;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @returns {Promise<{ status: string, bySlug: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchUsgs(locations) {
  const bySlug = new Map();
  let calls = 0;

  try {
    calls += 1;
    const data = await fetchJson(IV_URL, { timeoutMs: 90_000 });
    const gauges = parseNwisIv(data);
    if (gauges.size === 0) {
      return { status: 'error', bySlug, error: 'no USGS IV gauges parsed', calls };
    }

    const assigned = assignNearestGauges(locations, gauges);
    for (const [slug, row] of assigned) bySlug.set(slug, row);

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
      ...(bySlug.size === 0 ? { error: 'no gauges within 30 km of any location' } : {}),
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
