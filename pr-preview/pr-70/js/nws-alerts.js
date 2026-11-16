/**
 * Live Colorado NWS active-alert polling (browser → api.weather.gov).
 * Build-time alerts.geojson / payload alerts[] remain the warm cache and fallback.
 */

import { countyKeysForAlertProps, normalizeCountyKey } from './co-counties.js';
import { hydrateAlertGeometries } from './nws-zone-geometry.js';

export const ALERTS_UPDATED_EVENT = 'cowx:alerts-updated';

const NWS_ACTIVE_CO = 'https://api.weather.gov/alerts/active?area=CO';
const DEFAULT_INTERVAL_MS = 180_000;
const FETCH_TIMEOUT_MS = 15_000;

/** @type {Map<string, object[]>} */
let byCounty = new Map();
/** @type {{ type: string, features: object[] }} */
let alertsGeoJson = { type: 'FeatureCollection', features: [] };
/** @type {string[]} */
let lastAlertIds = [];
let liveReady = false;
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
let fetchInFlight = false;
let visibilityBound = false;
let intervalMs = DEFAULT_INTERVAL_MS;

/**
 * Ray-cast point-in-ring (lon/lat). Ring is [[lon,lat], ...] (GeoJSON order).
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  /** @type {number[][]} */
  const pts = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([x, y]);
  }
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const denom = yj - yi || Number.EPSILON;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {{ type?: string, coordinates?: unknown }} geometry
 * @returns {boolean}
 */
export function pointInGeometry(lon, lat, geometry) {
  if (!geometry?.type || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    const rings = /** @type {number[][][]} */ (geometry.coordinates);
    if (!rings[0] || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(lon, lat, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = /** @type {number[][][][]} */ (geometry.coordinates);
    return polys.some((poly) => pointInGeometry(lon, lat, { type: 'Polygon', coordinates: poly }));
  }
  return false;
}

/**
 * Normalize a raw NWS alert Feature into the COWX summary shape.
 * @param {object} feature
 * @returns {{
 *   summary: {
 *     event: string,
 *     headline: string,
 *     description: string,
 *     ends: string | null,
 *     severity: string | null,
 *     areaDesc: string,
 *     id: string | null,
 *     url: string | null,
 *   },
 *   countyKeys: string[],
 *   geometry: object | null,
 * }}
 */
export function normalizeAlertFeature(feature) {
  const props = feature?.properties ?? {};
  const event = props.event ?? 'Alert';
  const headline = props.headline ?? '';
  const description = props.description ?? '';
  const ends = props.ends ?? props.expires ?? null;
  const severity = props.severity ?? null;
  const areas = props.areaDesc ?? '';
  const rawId = props.id ?? props['@id'] ?? null;
  const url =
    rawId == null
      ? null
      : String(rawId).startsWith('http')
        ? String(rawId)
        : `https://api.weather.gov/alerts/${rawId}`;

  return {
    summary: {
      event,
      headline,
      description,
      ends,
      severity,
      areaDesc: areas,
      id: rawId != null ? String(rawId) : null,
      url,
    },
    countyKeys: countyKeysForAlertProps(props),
    geometry: feature?.geometry ?? null,
  };
}

/**
 * Build county index + geometry FeatureCollection from NWS active-alert features.
 * @param {object[]} features
 * @returns {{
 *   byCounty: Map<string, object[]>,
 *   alertsGeoJson: { type: string, features: object[] },
 * }}
 */
export function buildAlertIndex(features) {
  /** @type {Map<string, object[]>} */
  const countyMap = new Map();
  /** @type {object[]} */
  const withGeom = [];

  for (const f of features) {
    const { summary, geometry, countyKeys } = normalizeAlertFeature(f);
    for (const key of countyKeys) {
      if (!countyMap.has(key)) countyMap.set(key, []);
      countyMap.get(key).push(summary);
    }
    if (geometry) {
      withGeom.push({
        type: 'Feature',
        geometry,
        properties: summary,
      });
    }
  }

  return {
    byCounty: countyMap,
    alertsGeoJson: { type: 'FeatureCollection', features: withGeom },
  };
}

/**
 * Merge county-matched alerts with geometry-contains matches (dedupe by id/event+ends).
 * @param {number} lat
 * @param {number} lon
 * @param {string} countyKey
 * @param {Map<string, object[]>} countyIndex
 * @param {{ features?: object[] }} geoJson
 * @returns {object[]}
 */
export function alertsForLocation(lat, lon, countyKey, countyIndex, geoJson) {
  /** @type {Map<string, object>} */
  const byKey = new Map();
  const add = (/** @type {object} */ a) => {
    const key = String(a.id ?? `${a.event}|${a.ends}|${a.headline}`);
    if (!byKey.has(key)) byKey.set(key, a);
  };

  const county = normalizeCountyKey(countyKey);
  for (const a of countyIndex.get(county) ?? []) add(a);

  const features = Array.isArray(geoJson?.features) ? geoJson.features : [];
  for (const f of features) {
    if (!f?.geometry) continue;
    if (!pointInGeometry(lon, lat, f.geometry)) continue;
    const props = f.properties ?? f;
    add(props);
  }

  return [...byKey.values()];
}

/**
 * @returns {boolean}
 */
export function hasLiveAlerts() {
  return liveReady;
}

/**
 * Statewide polygons for the map layer (empty until first successful poll).
 * @returns {{ type: string, features: object[] }}
 */
export function getAlertPolygons() {
  return alertsGeoJson;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} [county]
 * @returns {object[]}
 */
export function getAlertsForLocation(lat, lon, county = '') {
  if (!liveReady) return [];
  return alertsForLocation(lat, lon, county, byCounty, alertsGeoJson);
}

/**
 * Prefer live NWS alerts when the poller has succeeded; else payload alerts.
 * Pin lat/lon wins for geometry matching when set; catalog county always.
 * @param {Record<string, unknown>} data
 * @param {{ lat?: number, lon?: number } | null} [pin]
 * @returns {object[]}
 */
export function resolveLocationAlerts(data, pin = null) {
  const fallback = Array.isArray(data.alerts) ? /** @type {object[]} */ (data.alerts) : [];
  if (!liveReady) return fallback;

  const lat = pin?.lat != null ? Number(pin.lat) : Number(data.lat);
  const lon = pin?.lon != null ? Number(pin.lon) : Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;

  return getAlertsForLocation(lat, lon, String(data.county ?? ''));
}

/**
 * @param {object[]} features
 * @returns {string[]}
 */
function alertIdList(features) {
  return features
    .map((f) => {
      const props = f?.properties ?? {};
      const id = props.id ?? props['@id'] ?? null;
      return id != null
        ? String(id)
        : `${props.event}|${props.ends ?? props.expires}|${props.headline}`;
    })
    .sort();
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function idsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Apply a successful NWS response (also used by tests).
 * @param {{ features?: object[] }} geojson
 * @returns {{ changed: boolean }}
 */
export function applyAlertResponse(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const nextIds = alertIdList(features);
  const changed = !liveReady || !idsEqual(nextIds, lastAlertIds);
  const indexed = buildAlertIndex(features);
  byCounty = indexed.byCounty;
  alertsGeoJson = indexed.alertsGeoJson;
  lastAlertIds = nextIds;
  liveReady = true;
  return { changed };
}

/**
 * @returns {Promise<{ changed: boolean, ok: boolean }>}
 */
export async function fetchActiveAlerts() {
  if (fetchInFlight) return { changed: false, ok: liveReady };
  fetchInFlight = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NWS_ACTIVE_CO, {
      headers: { Accept: 'application/geo+json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`NWS alerts HTTP ${res.status}`);
    const json = await res.json();
    const rawFeatures = Array.isArray(json?.features) ? json.features : [];
    // Zone watches (Flood Watch, etc.) arrive with geometry: null — hydrate from
    // COZ/COC polygons so the map can draw every affected area.
    const features = await hydrateAlertGeometries(rawFeatures, {
      fetchZoneJson: async (url) => {
        const zoneRes = await fetch(url, {
          headers: { Accept: 'application/geo+json' },
          cache: 'force-cache',
          signal: controller.signal,
        });
        if (!zoneRes.ok) throw new Error(`NWS zone HTTP ${zoneRes.status}`);
        return zoneRes.json();
      },
      concurrency: 6,
    });
    const { changed } = applyAlertResponse({ features });
    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(ALERTS_UPDATED_EVENT, {
          detail: { featureCount: alertsGeoJson.features.length },
        }),
      );
    }
    return { changed, ok: true };
  } catch (err) {
    console.warn('nws-alerts: live fetch failed', err);
    return { changed: false, ok: false };
  } finally {
    clearTimeout(timer);
    fetchInFlight = false;
  }
}

function clearPollTimer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPollTimer() {
  clearPollTimer();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  pollTimer = setInterval(() => {
    void fetchActiveAlerts();
  }, intervalMs);
}

/**
 * Start (or restart) visibility-aware polling of Colorado active alerts.
 * @param {{ intervalMs?: number }} [opts]
 */
export function initAlertPolling(opts = {}) {
  intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearPollTimer();
        return;
      }
      void fetchActiveAlerts();
      startPollTimer();
    });
  }

  void fetchActiveAlerts();
  startPollTimer();
}

/**
 * Test/reset helper — clears live state and stops the timer.
 */
export function _resetAlertPollingForTests() {
  clearPollTimer();
  byCounty = new Map();
  alertsGeoJson = { type: 'FeatureCollection', features: [] };
  lastAlertIds = [];
  liveReady = false;
  fetchInFlight = false;
}
