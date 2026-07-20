/**
 * CDOT / COtrip cameras (CARS) + RWIS + live alerts (ArcGIS) — no token.
 * Failure point: upstream timeout / schema drift.
 * Fallback: status error/partial; payloads get null camera/rwis/alerts.
 */

import { fetchJson } from '../../lib/http.js';
import { haversineKm, nearestPoint, nearestPoints } from '../../lib/geo.js';

const CAMERAS_URL = 'https://cotg.carsprogram.org/cameras_v1/api/cameras';
const RWIS_ARCGIS =
  'https://maps.codot.gov/server/rest/services/Hosted/CoTrip_Weather_Stations_(Live)_Public_View/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
const ALERTS_POINTS_ARCGIS =
  'https://maps.codot.gov/server/rest/services/Hosted/CoTrip_Alerts_Points_(Live)_Public_View/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
const ALERTS_POLYLINE_ARCGIS =
  'https://maps.codot.gov/server/rest/services/Hosted/CoTrip_Alerts_Polyline_(Live)_Public_View/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';

const MAX_CAMERA_KM = 40;
const MAX_CAMERAS = 3;
const MAX_RWIS_KM = 40;
const MAX_ALERT_POINT_KM = 75;
const MAX_ALERT_POLY_KM = 50;
const MAX_ALERTS = 5;
const COTRIP_MAP = 'https://maps.cotrip.org';

const PASS_HINT_RE =
  /\b(i-?70|us-?550|us-?40|us-?285|us-?160|us-?50|loveland|vail|eisenhower|monarch|wolf creek|red mountain|independence|cottonwood|hoosier|berthoud|rabbit ears|cameron|trail ridge|molas|coal bank)\b/i;
const CHAIN_RE = /\bchain\b/i;
const CLOSURE_RE = /\b(closure|closed|roadway.?closure)\b/i;

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
 * @returns {{ id: string, name: string, lat: number, lon: number, imageUrl: string | null, pageUrl: string }[]}
 */
export function parseCameras(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const cam of raw) {
    if (!cam || typeof cam !== 'object') continue;
    if (cam.public === false || cam.active === false) continue;
    const lat = num(cam.location?.latitude);
    const lon = num(cam.location?.longitude);
    if (lat == null || lon == null) continue;
    const views = Array.isArray(cam.views) ? cam.views : [];
    const view = views.find((v) => v?.videoPreviewUrl) ?? views[0] ?? null;
    const imageUrl = view?.videoPreviewUrl ? String(view.videoPreviewUrl) : null;
    const id = String(cam.id ?? '');
    if (!id) continue;
    out.push({
      id,
      name: String(cam.name ?? view?.name ?? `Camera ${id}`),
      lat,
      lon,
      imageUrl,
      pageUrl: `${COTRIP_MAP}/?lat=${lat}&lon=${lon}&zoom=12`,
    });
  }
  return out;
}

/**
 * Parse ArcGIS GeoJSON RWIS features (may include stale timestamps — still useful for identity).
 * @param {unknown} raw
 */
export function parseRwisGeoJson(raw) {
  const features =
    raw && typeof raw === 'object' && Array.isArray(raw.features) ? raw.features : [];
  const out = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const lat = num(p.ws_latitude) ?? num(f?.geometry?.coordinates?.[1]);
    const lon = num(p.ws_longitude) ?? num(f?.geometry?.coordinates?.[0]);
    if (lat == null || lon == null) continue;
    const id = String(p.ws_deviceid ?? p.ws_weatherstationid ?? p.objectid ?? '');
    if (!id) continue;

    let observed = null;
    const ts = num(p.ws_devicecollectiondt) ?? num(p.ws_lastupdatedate) ?? num(p.last_edited_date);
    if (ts != null) {
      observed = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
    }

    out.push({
      id,
      name: String(p.ws_commonname ?? id),
      lat,
      lon,
      air_temp_f: num(p.ws_essairtemp),
      surface_temp_f: num(p.surfacesensor_esssurfacetempera),
      surface_status: p.surfacesensor_rwissurfacestatus
        ? String(p.surfacesensor_rwissurfacestatus)
        : null,
      humidity: num(p.ws_essrelhumidty),
      wind_speed_mph: num(p.ws_essavgwindspeed),
      wind_gust_mph: null,
      visibility_mi: num(p.ws_essvisibility),
      road: p.ws_roadname ? String(p.ws_roadname) : null,
      observed,
    });
  }
  return out;
}

/**
 * ArcGIS date field → ISO string.
 * @param {unknown} v
 * @returns {string | null}
 */
function arcgisDate(v) {
  const n = num(v);
  if (n != null) return new Date(n > 1e12 ? n : n * 1000).toISOString();
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Midpoint of a GeoJSON LineString or MultiLineString.
 * @param {unknown} geometry
 * @returns {{ lat: number, lon: number } | null}
 */
export function geometryMidpoint(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = /** @type {{ type?: string, coordinates?: unknown }} */ (geometry);
  /** @type {number[][]} */
  let coords = [];
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    coords = /** @type {number[][]} */ (g.coordinates);
  } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    for (const part of g.coordinates) {
      if (Array.isArray(part)) coords.push(.../** @type {number[][]} */ (part));
    }
  } else if (g.type === 'Point' && Array.isArray(g.coordinates)) {
    const lon = num(g.coordinates[0]);
    const lat = num(g.coordinates[1]);
    if (lat != null && lon != null) return { lat, lon };
    return null;
  }
  if (coords.length === 0) return null;
  const mid = coords[Math.floor(coords.length / 2)];
  const lon = num(mid?.[0]);
  const lat = num(mid?.[1]);
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

/**
 * Normalize CoTrip alert GeoJSON (points or polylines).
 * @param {unknown} raw
 * @param {'point' | 'polyline'} source
 */
export function parseAlertsGeoJson(raw, source = 'point') {
  const features =
    raw && typeof raw === 'object' && Array.isArray(raw.features) ? raw.features : [];
  const out = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    let lat = num(p.startlatitude) ?? num(f?.geometry?.coordinates?.[1]);
    let lon = num(p.startlongitude) ?? num(f?.geometry?.coordinates?.[0]);
    if ((lat == null || lon == null) && source === 'polyline') {
      const mid = geometryMidpoint(f?.geometry);
      if (mid) {
        lat = mid.lat;
        lon = mid.lon;
      }
    }
    if (lat == null || lon == null) {
      lat = num(p.endlocationlatitude);
      lon = num(p.endlocationlongitude);
    }
    if (lat == null || lon == null) continue;

    const id = String(p.alertid ?? p.globalid ?? p.objectid ?? '');
    if (!id) continue;

    const title = String(p.title ?? p.headline ?? p.type ?? 'Travel alert');
    const type = p.type ? String(p.type) : null;
    const roads = p.roadname ? String(p.roadname) : null;
    const description = p.description
      ? String(p.description).slice(0, 500)
      : p.headline
        ? String(p.headline).slice(0, 500)
        : null;
    const impact = p.impact ? String(p.impact) : null;
    const textBlob = [title, type, roads, description, impact, p.roadwayclosure]
      .filter(Boolean)
      .join(' ');

    out.push({
      id,
      title,
      type,
      severity: impact,
      roads,
      description,
      observed: arcgisDate(p.lastupdateddate) ?? arcgisDate(p.reportedtime) ?? null,
      lat,
      lon,
      source,
      chain_law: CHAIN_RE.test(textBlob),
      closure: CLOSURE_RE.test(textBlob) || String(p.roadwayclosure ?? '').toLowerCase() === 'yes',
      pass_relevant: PASS_HINT_RE.test(textBlob),
    });
  }
  return out;
}

/**
 * Pick nearest alerts for a location (points preferred within radius).
 * @param {{ lat: number, lon: number }} loc
 * @param {ReturnType<typeof parseAlertsGeoJson>} alerts
 * @param {number} [maxN]
 */
export function assignAlertsForLocation(loc, alerts, maxN = MAX_ALERTS) {
  const scored = [];
  for (const a of alerts) {
    const maxKm = a.source === 'polyline' ? MAX_ALERT_POLY_KM : MAX_ALERT_POINT_KM;
    const d = haversineKm(loc, a);
    if (d > maxKm) continue;
    scored.push({
      ...a,
      distance_km: Math.round(d * 10) / 10,
    });
  }
  scored.sort((a, b) => {
    const pri = (x) => (x.closure || x.chain_law ? 0 : x.pass_relevant ? 1 : 2);
    const pd = pri(a) - pri(b);
    if (pd !== 0) return pd;
    return a.distance_km - b.distance_km;
  });
  return scored.slice(0, maxN);
}

/**
 * Assign up to MAX_CAMERAS nearest cameras; prefer ≤40 km, else nearest statewide.
 * @param {{ lat: number, lon: number }} loc
 * @param {ReturnType<typeof parseCameras>} cameras
 */
export function assignCamerasForLocation(loc, cameras) {
  if (!cameras.length) return [];
  const near = nearestPoints(loc, cameras, MAX_CAMERAS).filter(
    (h) => h.distanceKm <= MAX_CAMERA_KM,
  );
  const hits = near.length > 0 ? near : nearestPoints(loc, cameras, 1);
  return hits.map((h) => {
    const p = /** @type {ReturnType<typeof parseCameras>[0]} */ (h.point);
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      distance_km: Math.round(h.distanceKm * 10) / 10,
      imageUrl: p.imageUrl,
      pageUrl: p.pageUrl,
    };
  });
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchCdot(locations) {
  /** @type {Map<string, { camera: object | null, cameras: object[], rwis: object | null, alerts: object[], cdot_roads: object }>} */
  const bySlug = new Map();
  let calls = 0;
  /** @type {{ type: string, features: object[] }} */
  let camerasGeoJson = { type: 'FeatureCollection', features: [] };
  /** @type {{ type: string, features: object[] }} */
  let alertsGeoJson = { type: 'FeatureCollection', features: [] };
  const errors = [];
  const updatedAt = new Date().toISOString();

  let cameras = [];
  let rwis = [];
  /** @type {ReturnType<typeof parseAlertsGeoJson>} */
  let alerts = [];

  try {
    const camerasRaw = await fetchJson(CAMERAS_URL, { timeoutMs: 45_000 });
    calls += 1;
    cameras = parseCameras(camerasRaw);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const rwisRaw = await fetchJson(RWIS_ARCGIS, { timeoutMs: 45_000 });
    calls += 1;
    rwis = parseRwisGeoJson(rwisRaw);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const pointsRaw = await fetchJson(ALERTS_POINTS_ARCGIS, { timeoutMs: 45_000 });
    calls += 1;
    alerts = alerts.concat(parseAlertsGeoJson(pointsRaw, 'point'));
  } catch (err) {
    errors.push(`alerts-points: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const polyRaw = await fetchJson(ALERTS_POLYLINE_ARCGIS, { timeoutMs: 45_000 });
    calls += 1;
    alerts = alerts.concat(parseAlertsGeoJson(polyRaw, 'polyline'));
  } catch (err) {
    errors.push(`alerts-polyline: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Dedupe alerts by id
  const byAlertId = new Map();
  for (const a of alerts) {
    if (!byAlertId.has(a.id)) byAlertId.set(a.id, a);
  }
  alerts = [...byAlertId.values()];

  camerasGeoJson = {
    type: 'FeatureCollection',
    features: cameras.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: {
        id: c.id,
        name: c.name,
        imageUrl: c.imageUrl,
        pageUrl: c.pageUrl,
      },
    })),
  };

  alertsGeoJson = {
    type: 'FeatureCollection',
    features: alerts.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        title: a.title,
        type: a.type,
        roads: a.roads,
        chain_law: a.chain_law,
        closure: a.closure,
        pass_relevant: a.pass_relevant,
        observed: a.observed,
      },
    })),
  };

  if (!cameras.length && !rwis.length && !alerts.length) {
    for (const loc of locations) {
      const emptyRoads = {
        updatedAt,
        alerts: [],
        cameras: [],
        rwis: null,
        links: { cotrip: COTRIP_MAP },
      };
      bySlug.set(loc.slug, {
        camera: null,
        cameras: [],
        rwis: null,
        alerts: [],
        cdot_roads: emptyRoads,
      });
    }
    return {
      status: 'error',
      bySlug,
      camerasGeoJson,
      alertsGeoJson,
      calls,
      error: (errors.join('; ') || 'CDOT cameras, RWIS, and alerts unavailable').slice(0, 500),
    };
  }

  let matchedCam = 0;
  let matchedRwis = 0;
  let matchedAlerts = 0;

  for (const loc of locations) {
    const camList = assignCamerasForLocation({ lat: loc.lat, lon: loc.lon }, cameras);
    if (camList.length) matchedCam += 1;
    const camera = camList[0] ?? null;

    const rwisHit = nearestPoint({ lat: loc.lat, lon: loc.lon }, rwis);
    let rwisRec = null;
    if (rwisHit && rwisHit.distanceKm <= MAX_RWIS_KM) {
      matchedRwis += 1;
      const p = /** @type {ReturnType<typeof parseRwisGeoJson>[0]} */ (rwisHit.point);
      rwisRec = {
        ...p,
        distance_km: Math.round(rwisHit.distanceKm * 10) / 10,
        url: COTRIP_MAP,
      };
    }

    const locAlerts = assignAlertsForLocation({ lat: loc.lat, lon: loc.lon }, alerts);
    if (locAlerts.length) matchedAlerts += 1;

    const cdot_roads = {
      updatedAt,
      alerts: locAlerts,
      cameras: camList,
      rwis: rwisRec,
      links: { cotrip: COTRIP_MAP },
    };

    bySlug.set(loc.slug, {
      camera,
      cameras: camList,
      rwis: rwisRec,
      alerts: locAlerts,
      cdot_roads,
    });
  }

  const status =
    matchedCam === 0 && matchedRwis === 0 && matchedAlerts === 0
      ? 'partial'
      : errors.length
        ? 'partial'
        : 'ok';

  return {
    status,
    bySlug,
    camerasGeoJson,
    alertsGeoJson,
    calls,
    error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
  };
}
