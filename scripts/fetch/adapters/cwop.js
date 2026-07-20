/**
 * CWOP / APRS weather via aprs.me nearby API (no token).
 * Failure point: aprs.me timeout / rate limits.
 * Fallback: status skipped/error; payloads get cwop: null.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

const NEARBY_URL = 'https://aprs.me/api/v1/weather/nearby';
const MAX_DISTANCE_KM = 40;
const GRID_RADIUS_MI = 55;
const GRID_LIMIT = 80;

/** Colorado sampling grid (covers Front Range + mountains + western slope). */
const SAMPLE_POINTS = [
  { lat: 40.6, lon: -105.0 },
  { lat: 40.0, lon: -105.3 },
  { lat: 39.7, lon: -104.9 },
  { lat: 39.2, lon: -104.7 },
  { lat: 38.8, lon: -104.8 },
  { lat: 38.3, lon: -104.6 },
  { lat: 37.5, lon: -105.0 },
  { lat: 40.5, lon: -106.8 },
  { lat: 39.6, lon: -106.4 },
  { lat: 39.2, lon: -106.9 },
  { lat: 38.5, lon: -106.0 },
  { lat: 37.8, lon: -106.9 },
  { lat: 40.3, lon: -108.0 },
  { lat: 39.1, lon: -108.5 },
  { lat: 38.0, lon: -108.0 },
  { lat: 40.0, lon: -103.2 },
  { lat: 38.5, lon: -102.8 },
];

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
 * @param {unknown} raw
 * @returns {{ callsign: string, lat: number, lon: number, temp_f: number | null, humidity: number | null, pressure_mb: number | null, wind_speed_mph: number | null, wind_gust_mph: number | null, wind_dir_deg: number | null, observed: string | null }[]}
 */
export function parseNearbyStations(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const lat = num(row.position?.lat ?? row.lat);
    const lon = num(row.position?.lon ?? row.lon);
    if (lat == null || lon == null) continue;
    // Rough CO bbox filter
    if (lat < 36.8 || lat > 41.2 || lon < -109.3 || lon > -101.8) continue;
    const callsign = String(row.callsign ?? row.base_callsign ?? '');
    if (!callsign) continue;
    const wx = row.weather ?? {};
    // aprs.me weather nearby returns °F and mph for US CWOP/APRS packets.
    out.push({
      callsign,
      lat,
      lon,
      temp_f: num(wx.temperature),
      humidity: num(wx.humidity),
      pressure_mb: num(wx.pressure),
      wind_speed_mph: num(wx.wind_speed),
      wind_gust_mph: num(wx.wind_gust),
      wind_dir_deg: num(wx.wind_direction),
      observed: row.last_report ? String(row.last_report) : null,
    });
  }
  return out;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchCwop(locations) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;
  /** @type {Map<string, ReturnType<typeof parseNearbyStations>[0]>} */
  const byCall = new Map();

  try {
    for (const pt of SAMPLE_POINTS) {
      const url = `${NEARBY_URL}?lat=${pt.lat}&lon=${pt.lon}&radius=${GRID_RADIUS_MI}&limit=${GRID_LIMIT}&hours=6`;
      try {
        const raw = await fetchJson(url, { timeoutMs: 20_000 });
        calls += 1;
        for (const st of parseNearbyStations(raw)) {
          const prev = byCall.get(st.callsign);
          if (!prev) byCall.set(st.callsign, st);
        }
      } catch {
        calls += 1;
        /* continue other grid cells */
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    const stations = [...byCall.values()];
    if (stations.length === 0) {
      for (const loc of locations) bySlug.set(loc.slug, null);
      return {
        status: 'skipped',
        bySlug,
        geojson: { type: 'FeatureCollection', features: [] },
        calls,
        error: 'No CWOP/APRS stations returned from aprs.me',
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
      const hit = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
      if (hit && hit.distanceKm <= MAX_DISTANCE_KM) {
        matched += 1;
        const p = /** @type {ReturnType<typeof parseNearbyStations>[0]} */ (hit.point);
        bySlug.set(loc.slug, {
          ...p,
          distance_km: Math.round(hit.distanceKm * 10) / 10,
        });
      } else {
        bySlug.set(loc.slug, null);
      }
    }

    return {
      status: matched === 0 ? 'partial' : matched < locations.length ? 'partial' : 'ok',
      bySlug,
      geojson,
      calls,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'error',
      bySlug,
      geojson: { type: 'FeatureCollection', features: [] },
      calls,
      error: msg.slice(0, 500),
    };
  }
}
