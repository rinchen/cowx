/**
 * House-level hyperlocal overlays from a browser-saved pin.
 * Failure point: geojson missing / Open-Meteo timeout.
 * Fallback: caller keeps catalog-assigned cameras/PWS/current.
 */

import { haversineKm } from './geo.js';
import { wmoLabel } from './wmo.js';

/** @typedef {import('./geo.js').HyperlocalPin} HyperlocalPin */

const OM_TIMEOUT_MS = 10_000;
const MAX_CAMERAS = 3;
const MAX_ALERTS = 5;
const MAX_CAMERA_KM = 80;
const MAX_ALERT_KM = 75;
const MAX_PWS_KM = 60;

/** @type {Map<string, Promise<unknown>>} */
const geoJsonCache = new Map();

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchGeoJsonCached(url) {
  const existing = geoJsonCache.get(url);
  if (existing) return existing;
  const p = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  })();
  geoJsonCache.set(url, p);
  return p.catch((err) => {
    geoJsonCache.delete(url);
    throw err;
  });
}

/**
 * @param {unknown} raw
 * @returns {{ lat: number, lon: number, props: Record<string, unknown> }[]}
 */
export function featuresFromGeoJson(raw) {
  const features =
    raw &&
    typeof raw === 'object' &&
    Array.isArray(/** @type {{ features?: unknown }} */ (raw).features)
      ? /** @type {{ geometry?: { coordinates?: unknown }, properties?: Record<string, unknown> }[]} */ (
          /** @type {{ features: unknown }} */ (raw).features
        )
      : [];
  const out = [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      lat,
      lon,
      props: f.properties && typeof f.properties === 'object' ? f.properties : {},
    });
  }
  return out;
}

/**
 * @template T
 * @param {number} lat
 * @param {number} lon
 * @param {{ lat: number, lon: number, item: T }[]} candidates
 * @param {number} limit
 * @param {number} maxKm
 * @returns {(T & { distance_km: number })[]}
 */
export function nearestFromPin(lat, lon, candidates, limit, maxKm) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !candidates.length || limit <= 0) {
    return [];
  }
  return candidates
    .map((c) => ({
      item: c.item,
      distance_km: Math.round(haversineKm(lat, lon, c.lat, c.lon) * 10) / 10,
    }))
    .filter((c) => c.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit)
    .map((c) => ({ ...c.item, distance_km: c.distance_km }));
}

/**
 * Map Open-Meteo current block → UI current shape (imperial).
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function mapOpenMeteoCurrent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cur = /** @type {Record<string, unknown>} */ (raw).current;
  if (!cur || typeof cur !== 'object') return null;
  const c = /** @type {Record<string, unknown>} */ (cur);
  const code = c.weather_code != null ? Number(c.weather_code) : null;
  return {
    temp_f: c.temperature_2m != null ? Number(c.temperature_2m) : null,
    feels_like_f: c.apparent_temperature != null ? Number(c.apparent_temperature) : null,
    humidity: c.relative_humidity_2m != null ? Number(c.relative_humidity_2m) : null,
    dewpoint_f: c.dewpoint_2m != null ? Number(c.dewpoint_2m) : null,
    weather_code: Number.isFinite(code) ? code : null,
    condition: Number.isFinite(code) ? wmoLabel(code) : null,
    wind_speed_mph: c.wind_speed_10m != null ? Number(c.wind_speed_10m) : null,
    wind_dir_deg: c.wind_direction_10m != null ? Number(c.wind_direction_10m) : null,
    wind_gust_mph: c.wind_gusts_10m != null ? Number(c.wind_gusts_10m) : null,
    uv_index: c.uv_index != null ? Number(c.uv_index) : null,
    is_day: c.is_day != null ? Number(c.is_day) : null,
    visibility_m: c.visibility != null ? Number(c.visibility) : null,
    cloud_cover: c.cloud_cover != null ? Number(c.cloud_cover) : null,
    pressure_mb: c.pressure_msl != null ? Number(c.pressure_msl) : null,
    time: c.time != null ? String(c.time) : null,
  };
}

/**
 * One keyless Open-Meteo current request for the pin.
 * @param {HyperlocalPin} pin
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchPinCurrent(pin) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(String(pin.lat))}` +
    `&longitude=${encodeURIComponent(String(pin.lon))}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day,dewpoint_2m,visibility,cloud_cover,pressure_msl` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FDenver`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`hyperlocal: pin current HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return mapOpenMeteoCurrent(json);
  } catch (err) {
    console.warn('hyperlocal: pin current fetch failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build pin-relative overlays from statewide geojson + optional Open-Meteo current.
 * @param {HyperlocalPin} pin
 * @param {{ dataBase?: string, skipOpenMeteo?: boolean }} [opts]
 */
export async function buildHyperlocalOverlay(pin, opts = {}) {
  const base = opts.dataBase ?? 'data';
  /** @type {{ cameras: object[], alerts: object[], pws: object | null, current: Record<string, unknown> | null }} */
  const out = { cameras: [], alerts: [], pws: null, current: null };

  const [camsRaw, alertsRaw, cwopRaw, current] = await Promise.all([
    fetchGeoJsonCached(`${base}/cdot-cameras.geojson`).catch((err) => {
      console.warn('hyperlocal: cameras geojson failed', err);
      return null;
    }),
    fetchGeoJsonCached(`${base}/cdot-alerts.geojson`).catch((err) => {
      console.warn('hyperlocal: alerts geojson failed', err);
      return null;
    }),
    fetchGeoJsonCached(`${base}/cwop.geojson`).catch((err) => {
      console.warn('hyperlocal: cwop geojson failed', err);
      return null;
    }),
    opts.skipOpenMeteo ? Promise.resolve(null) : fetchPinCurrent(pin),
  ]);

  out.current = current;

  const camPts = featuresFromGeoJson(camsRaw).map((f) => ({
    lat: f.lat,
    lon: f.lon,
    item: {
      id: String(f.props.id ?? ''),
      name: String(f.props.name ?? 'Camera'),
      lat: f.lat,
      lon: f.lon,
      imageUrl: f.props.imageUrl ? String(f.props.imageUrl) : null,
      pageUrl: f.props.pageUrl ? String(f.props.pageUrl) : null,
    },
  }));
  out.cameras = nearestFromPin(pin.lat, pin.lon, camPts, MAX_CAMERAS, MAX_CAMERA_KM);

  const alertPts = featuresFromGeoJson(alertsRaw).map((f) => ({
    lat: f.lat,
    lon: f.lon,
    item: {
      id: String(f.props.id ?? ''),
      title: String(f.props.title ?? 'Travel alert'),
      type: f.props.type != null ? String(f.props.type) : null,
      roads: f.props.roads != null ? String(f.props.roads) : null,
      chain_law: Boolean(f.props.chain_law),
      closure: Boolean(f.props.closure),
      pass_relevant: Boolean(f.props.pass_relevant),
      observed: f.props.observed != null ? String(f.props.observed) : null,
      lat: f.lat,
      lon: f.lon,
    },
  }));
  out.alerts = nearestFromPin(pin.lat, pin.lon, alertPts, MAX_ALERTS, MAX_ALERT_KM);

  const cwopPts = featuresFromGeoJson(cwopRaw).map((f) => ({
    lat: f.lat,
    lon: f.lon,
    item: {
      callsign: String(f.props.callsign ?? ''),
      network: String(f.props.network ?? 'CWOP/APRS'),
      temp_f: f.props.temp_f != null ? Number(f.props.temp_f) : null,
      humidity: f.props.humidity != null ? Number(f.props.humidity) : null,
      wind_speed_mph: f.props.wind_speed_mph != null ? Number(f.props.wind_speed_mph) : null,
      observed: f.props.observed != null ? String(f.props.observed) : null,
      lat: f.lat,
      lon: f.lon,
    },
  }));
  const pwsList = nearestFromPin(pin.lat, pin.lon, cwopPts, 2, MAX_PWS_KM);
  if (pwsList.length) {
    out.pws = {
      primary: pwsList[0],
      nearby: pwsList.slice(1),
      links: {
        aprs: `https://aprs.fi/#!call=a%2F${encodeURIComponent(pwsList[0].callsign)}`,
      },
    };
  }

  return out;
}

/** @internal test helper */
export function _clearHyperlocalCache() {
  geoJsonCache.clear();
}
