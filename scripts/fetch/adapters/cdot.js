/**
 * CDOT / COtrip cameras (CARS) + RWIS (ArcGIS FeatureServer) — no token.
 * Failure point: upstream timeout / schema drift.
 * Fallback: status error/partial; payloads get null camera/rwis.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

const CAMERAS_URL = 'https://cotg.carsprogram.org/cameras_v1/api/cameras';
const RWIS_ARCGIS =
  'https://maps.codot.gov/server/rest/services/Hosted/CoTrip_Weather_Stations_(Live)_Public_View/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
const MAX_CAMERA_KM = 40;
const MAX_RWIS_KM = 40;
const COTRIP_MAP = 'https://maps.cotrip.org';

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
      // ArcGIS often stores ms epoch
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
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchCdot(locations) {
  /** @type {Map<string, { camera: object | null, rwis: object | null }>} */
  const bySlug = new Map();
  let calls = 0;
  /** @type {{ type: string, features: object[] }} */
  let camerasGeoJson = { type: 'FeatureCollection', features: [] };
  const errors = [];

  let cameras = [];
  let rwis = [];

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

  if (!cameras.length && !rwis.length) {
    for (const loc of locations) bySlug.set(loc.slug, { camera: null, rwis: null });
    return {
      status: 'error',
      bySlug,
      camerasGeoJson,
      calls,
      error: (errors.join('; ') || 'CDOT cameras and RWIS unavailable').slice(0, 500),
    };
  }

  let matchedCam = 0;
  let matchedRwis = 0;

  for (const loc of locations) {
    const camHit = nearestPoint({ lat: loc.lat, lon: loc.lon }, cameras);
    const rwisHit = nearestPoint({ lat: loc.lat, lon: loc.lon }, rwis);

    let camera = null;
    if (camHit && camHit.distanceKm <= MAX_CAMERA_KM) {
      matchedCam += 1;
      const p = /** @type {ReturnType<typeof parseCameras>[0]} */ (camHit.point);
      camera = {
        id: p.id,
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        distance_km: Math.round(camHit.distanceKm * 10) / 10,
        imageUrl: p.imageUrl,
        pageUrl: p.pageUrl,
      };
    }

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

    bySlug.set(loc.slug, { camera, rwis: rwisRec });
  }

  const status =
    matchedCam === 0 && matchedRwis === 0 ? 'partial' : errors.length ? 'partial' : 'ok';

  return {
    status,
    bySlug,
    camerasGeoJson,
    calls,
    error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
  };
}
