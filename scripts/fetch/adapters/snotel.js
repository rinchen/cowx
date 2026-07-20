/**
 * NRCS SNOTEL snowpack adapter — nearest CO SNTL site within 50 km for high elevation.
 * Failure point: AWDB REST timeout / empty parse.
 * Fallback: status error/partial; location payloads get snotel: null.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

const STATIONS_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations';
const DATA_URL = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data';
const MAX_DISTANCE_KM = 50;
const MIN_ELEVATION_FT = 7000;

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
 * @param {Date} d
 * @returns {string}
 */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Filter AWDB station list to active CO SNOTEL sites.
 * @param {unknown} raw
 * @returns {{ stationTriplet: string, station_id: string, station_name: string, lat: number, lon: number, elevation_ft: number | null }[]}
 */
export function filterCoSnotelStations(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    if (s.stateCode !== 'CO' || s.networkCode !== 'SNTL') continue;
    const lat = num(s.latitude);
    const lon = num(s.longitude);
    if (lat == null || lon == null) continue;
    const triplet = String(s.stationTriplet ?? '');
    if (!triplet) continue;
    out.push({
      stationTriplet: triplet,
      station_id: String(s.stationId ?? triplet.split(':')[0] ?? triplet),
      station_name: String(s.name ?? triplet),
      lat,
      lon,
      elevation_ft: num(s.elevation),
    });
  }
  return out;
}

/**
 * Latest value from AWDB element values array.
 * @param {{ date?: string, value?: unknown }[] | undefined} values
 * @returns {{ value: number | null, date: string | null }}
 */
function latestValue(values) {
  if (!Array.isArray(values) || values.length === 0) return { value: null, date: null };
  const sorted = [...values].sort((a, b) =>
    String(a.date ?? '').localeCompare(String(b.date ?? '')),
  );
  const last = sorted[sorted.length - 1];
  return { value: num(last?.value), date: last?.date ? String(last.date) : null };
}

/**
 * 24h precip from water-year cumulative PREC (day N − day N-1).
 * @param {{ date?: string, value?: unknown }[] | undefined} values
 * @returns {number | null}
 */
export function precip24hFromPrec(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const sorted = [...values].sort((a, b) =>
    String(a.date ?? '').localeCompare(String(b.date ?? '')),
  );
  const a = num(sorted[sorted.length - 2]?.value);
  const b = num(sorted[sorted.length - 1]?.value);
  if (a == null || b == null) return null;
  const delta = b - a;
  return delta >= 0 ? Math.round(delta * 100) / 100 : null;
}

/**
 * Merge station metadata with AWDB data payload.
 * @param {ReturnType<typeof filterCoSnotelStations>} stations
 * @param {unknown} dataRaw
 * @returns {Map<string, object>}
 */
export function mergeSnotelData(stations, dataRaw) {
  /** @type {Map<string, object>} */
  const byTriplet = new Map();
  const metaByTriplet = new Map(stations.map((s) => [s.stationTriplet, s]));
  if (!Array.isArray(dataRaw)) return byTriplet;

  for (const row of dataRaw) {
    const triplet = String(row?.stationTriplet ?? '');
    const meta = metaByTriplet.get(triplet);
    if (!meta) continue;
    /** @type {Record<string, any>} */
    const elements = {};
    for (const block of row?.data ?? []) {
      const code = block?.stationElement?.elementCode;
      if (!code) continue;
      elements[code] = block.values;
    }
    const snwd = latestValue(elements.SNWD);
    const wteq = latestValue(elements.WTEQ);
    const tobs = latestValue(elements.TOBS);
    const observed = snwd.date || wteq.date || tobs.date || null;
    byTriplet.set(triplet, {
      station_name: meta.station_name,
      station_id: meta.station_id,
      stationTriplet: triplet,
      lat: meta.lat,
      lon: meta.lon,
      elevation_ft: meta.elevation_ft,
      snow_depth_in: snwd.value,
      swe_in: wteq.value,
      air_temp_f: tobs.value,
      precipitation_24h_in: precip24hFromPrec(elements.PREC),
      observed,
      url: `https://wcc.sc.egov.usda.gov/nwcc/site?siteno=${encodeURIComponent(meta.station_id)}`,
    });
  }
  return byTriplet;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {Map<string, any>} stationsByTriplet
 * @returns {Map<string, object>}
 */
export function assignNearestSnotel(locations, stationsByTriplet) {
  const candidates = [...stationsByTriplet.values()];
  /** @type {Map<string, object>} */
  const bySlug = new Map();

  for (const loc of locations) {
    const elev = loc.elevation_ft;
    if (elev == null || Number(elev) <= MIN_ELEVATION_FT) continue;
    const nearest = nearestPoint({ lat: loc.lat, lon: loc.lon }, candidates);
    if (!nearest || nearest.distanceKm > MAX_DISTANCE_KM) continue;
    const s = nearest.point;
    bySlug.set(loc.slug, {
      station_name: s.station_name,
      station_id: s.station_id,
      distance_km: Math.round(nearest.distanceKm * 10) / 10,
      elevation_ft: s.elevation_ft,
      snow_depth_in: s.snow_depth_in,
      swe_in: s.swe_in,
      air_temp_f: s.air_temp_f,
      precipitation_24h_in: s.precipitation_24h_in,
      observed: s.observed,
      url: s.url,
    });
  }
  return bySlug;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @returns {Promise<{ status: string, bySlug: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchSnotel(locations) {
  const bySlug = new Map();
  let calls = 0;

  try {
    calls += 1;
    const stationsRaw = await fetchJson(STATIONS_URL, { timeoutMs: 90_000 });
    const stations = filterCoSnotelStations(stationsRaw);
    if (stations.length === 0) {
      return { status: 'error', bySlug, error: 'no CO SNOTEL stations found', calls };
    }

    const end = new Date();
    const begin = new Date(end.getTime() - 2 * 24 * 60 * 60_000);
    const triplets = stations.map((s) => s.stationTriplet).join(',');
    const dataUrl =
      `${DATA_URL}?stationTriplets=${triplets}` +
      `&elements=SNWD,WTEQ,PREC,TOBS&duration=DAILY` +
      `&beginDate=${isoDate(begin)}&endDate=${isoDate(end)}`;

    calls += 1;
    const dataRaw = await fetchJson(dataUrl, { timeoutMs: 120_000 });
    const merged = mergeSnotelData(stations, dataRaw);
    if (merged.size === 0) {
      return { status: 'error', bySlug, error: 'no SNOTEL readings parsed', calls };
    }

    const assigned = assignNearestSnotel(locations, merged);
    for (const [slug, row] of assigned) bySlug.set(slug, row);

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
      ...(bySlug.size === 0
        ? { error: 'no SNOTEL stations within 50 km of high-elevation locations' }
        : {}),
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
