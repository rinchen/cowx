/**
 * CWOP / APRS weather via aprs.me nearby API (no token).
 * Failure point: aprs.me timeout / rate limits.
 * Fallback: status skipped/error; payloads get cwop/pws null.
 */

import { fetchJson, sleep } from '../../lib/http.js';
import { nearestPoints, roundKm } from '../../lib/geo.js';
import { isInColorado } from '../../lib/colorado.js';
import { toFiniteNumber } from '../../lib/parse.js';

const NEARBY_URL = 'https://aprs.me/api/v1/weather/nearby';
const MAX_DISTANCE_KM = 60;
const MAX_STATIONS = 2;
const GRID_RADIUS_MI = 55;
const GRID_LIMIT = 80;
const GRID_DELAY_MS = 120;

/**
 * Fixed denser Colorado sampling grid (Front Range + mountains + western slope + plains).
 * Hand-tuned spacing (~0.2–0.5°) to cover population centers and passes without
 * generating a full CO_BBOX lattice (would blow the aprs.me call budget).
 */
const SAMPLE_POINTS = [
  { lat: 40.7, lon: -104.9 },
  { lat: 40.5, lon: -105.1 },
  { lat: 40.4, lon: -105.5 },
  { lat: 40.2, lon: -105.1 },
  { lat: 40.0, lon: -105.3 },
  { lat: 39.9, lon: -105.0 },
  { lat: 39.7, lon: -104.9 },
  { lat: 39.6, lon: -105.2 },
  { lat: 39.4, lon: -104.8 },
  { lat: 39.2, lon: -104.7 },
  { lat: 38.9, lon: -104.8 },
  { lat: 38.8, lon: -104.8 },
  { lat: 38.5, lon: -104.6 },
  { lat: 38.3, lon: -104.6 },
  { lat: 37.8, lon: -104.8 },
  { lat: 37.5, lon: -105.0 },
  { lat: 40.5, lon: -106.8 },
  { lat: 40.0, lon: -106.5 },
  { lat: 39.6, lon: -106.4 },
  { lat: 39.4, lon: -106.2 },
  { lat: 39.2, lon: -106.9 },
  { lat: 38.9, lon: -106.3 },
  { lat: 38.5, lon: -106.0 },
  { lat: 38.0, lon: -106.5 },
  { lat: 37.8, lon: -106.9 },
  { lat: 37.3, lon: -107.0 },
  { lat: 40.5, lon: -107.5 },
  { lat: 40.3, lon: -108.0 },
  { lat: 39.5, lon: -108.0 },
  { lat: 39.1, lon: -108.5 },
  { lat: 38.5, lon: -108.0 },
  { lat: 38.0, lon: -108.0 },
  { lat: 37.5, lon: -108.0 },
  { lat: 40.5, lon: -103.5 },
  { lat: 40.0, lon: -103.2 },
  { lat: 39.0, lon: -103.0 },
  { lat: 38.5, lon: -102.8 },
  { lat: 37.5, lon: -102.5 },
];

/**
 * @param {unknown} raw
 * @returns {{ callsign: string, lat: number, lon: number, temp_f: number | null, humidity: number | null, pressure_mb: number | null, wind_speed_mph: number | null, wind_gust_mph: number | null, wind_dir_deg: number | null, observed: string | null }[]}
 */
export function parseNearbyStations(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const lat = toFiniteNumber(row.position?.lat ?? row.lat);
    const lon = toFiniteNumber(row.position?.lon ?? row.lon);
    if (lat == null || lon == null) continue;
    if (!isInColorado(lat, lon)) continue;
    const callsign = String(row.callsign ?? row.base_callsign ?? '');
    if (!callsign) continue;
    const wx = row.weather ?? {};
    out.push({
      callsign,
      lat,
      lon,
      temp_f: toFiniteNumber(wx.temperature),
      humidity: toFiniteNumber(wx.humidity),
      pressure_mb: toFiniteNumber(wx.pressure),
      wind_speed_mph: toFiniteNumber(wx.wind_speed),
      wind_gust_mph: toFiniteNumber(wx.wind_gust),
      wind_dir_deg: toFiniteNumber(wx.wind_direction),
      observed: row.last_report ? String(row.last_report) : null,
    });
  }
  return out;
}

/**
 * Build pws payload from nearest CWOP stations.
 * @param {{ lat: number, lon: number }} loc
 * @param {ReturnType<typeof parseNearbyStations>} stations
 * @param {{ wunderground?: string | null }} [linkOpts]
 */
export function assignPwsFromStations(loc, stations, linkOpts = {}) {
  const hits = nearestPoints(loc, stations, MAX_STATIONS).filter(
    (h) => h.distanceKm <= MAX_DISTANCE_KM,
  );
  if (!hits.length) return null;

  const mapped = hits.map((h) => {
    const p = /** @type {ReturnType<typeof parseNearbyStations>[0]} */ (h.point);
    return {
      callsign: p.callsign,
      network: 'CWOP/APRS',
      lat: p.lat,
      lon: p.lon,
      temp_f: p.temp_f,
      humidity: p.humidity,
      pressure_mb: p.pressure_mb,
      wind_speed_mph: p.wind_speed_mph,
      wind_gust_mph: p.wind_gust_mph,
      wind_dir_deg: p.wind_dir_deg,
      observed: p.observed,
      distance_km: roundKm(h.distanceKm),
    };
  });

  return {
    primary: mapped[0],
    nearby: mapped.slice(1),
    links: {
      aprs: `https://aprs.fi/#!call=a%2F${encodeURIComponent(mapped[0].callsign)}`,
      wunderground: linkOpts.wunderground ?? null,
    },
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{
 *   sleepFn?: (ms: number) => Promise<void>,
 *   samplePoints?: { lat: number, lon: number }[],
 * }} [opts]
 */
export async function fetchCwop(locations, opts = {}) {
  const sleepFn = opts.sleepFn ?? sleep;
  const samplePoints = opts.samplePoints ?? SAMPLE_POINTS;
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  /** @type {Map<string, object | null>} */
  const pwsBySlug = new Map();
  let calls = 0;
  /** @type {Map<string, ReturnType<typeof parseNearbyStations>[0]>} */
  const byCall = new Map();

  /** @type {string[]} */
  const errors = [];
  try {
    for (const pt of samplePoints) {
      const url = `${NEARBY_URL}?lat=${pt.lat}&lon=${pt.lon}&radius=${GRID_RADIUS_MI}&limit=${GRID_LIMIT}&hours=6`;
      try {
        const raw = await fetchJson(url, { timeoutMs: 20_000 });
        calls += 1;
        for (const st of parseNearbyStations(raw)) {
          if (!byCall.has(st.callsign)) byCall.set(st.callsign, st);
        }
      } catch (err) {
        calls += 1;
        errors.push(err instanceof Error ? err.message : String(err));
      }
      await sleepFn(GRID_DELAY_MS);
    }

    const stations = [...byCall.values()];
    if (stations.length === 0) {
      for (const loc of locations) {
        bySlug.set(loc.slug, null);
        pwsBySlug.set(loc.slug, null);
      }
      return {
        status: 'skipped',
        bySlug,
        pwsBySlug,
        geojson: { type: 'FeatureCollection', features: [] },
        calls,
        error: errors.slice(0, 5).join('; ') || 'No CWOP/APRS stations returned from aprs.me',
      };
    }

    const geojson = {
      type: 'FeatureCollection',
      features: stations.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          callsign: s.callsign,
          temp_f: s.temp_f,
          humidity: s.humidity,
          wind_speed_mph: s.wind_speed_mph,
          observed: s.observed,
          network: 'CWOP/APRS',
        },
      })),
    };

    let matched = 0;
    for (const loc of locations) {
      const wu = loc.pws_id
        ? `https://www.wunderground.com/dashboard/pws/${encodeURIComponent(loc.pws_id)}`
        : null;
      const pws = assignPwsFromStations({ lat: loc.lat, lon: loc.lon }, stations, {
        wunderground: wu,
      });
      if (pws) {
        matched += 1;
        const primary = pws.primary;
        bySlug.set(loc.slug, {
          callsign: primary.callsign,
          lat: primary.lat,
          lon: primary.lon,
          temp_f: primary.temp_f,
          humidity: primary.humidity,
          pressure_mb: primary.pressure_mb,
          wind_speed_mph: primary.wind_speed_mph,
          wind_gust_mph: primary.wind_gust_mph,
          wind_dir_deg: primary.wind_dir_deg,
          observed: primary.observed,
          distance_km: primary.distance_km,
        });
        pwsBySlug.set(loc.slug, pws);
      } else {
        bySlug.set(loc.slug, null);
        pwsBySlug.set(
          loc.slug,
          wu
            ? {
                primary: null,
                nearby: [],
                links: { aprs: null, wunderground: wu },
              }
            : null,
        );
      }
    }

    const gridPartial = errors.length > 0;
    const status = matched === 0 || matched < locations.length || gridPartial ? 'partial' : 'ok';
    return {
      status,
      bySlug,
      pwsBySlug,
      geojson,
      calls,
      error: gridPartial ? errors.slice(0, 5).join('; ') : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const loc of locations) {
      bySlug.set(loc.slug, null);
      pwsBySlug.set(loc.slug, null);
    }
    return {
      status: 'error',
      bySlug,
      pwsBySlug,
      geojson: { type: 'FeatureCollection', features: [] },
      calls,
      error: msg.slice(0, 500),
    };
  }
}
