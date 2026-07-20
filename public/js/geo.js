/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string; elevationFt?: number }} IndexEntry */

const EARTH_RADIUS_KM = 6371;
const IP_GEO_TIMEOUT_MS = 5000;
const IP_GEO_ENDPOINTS = ['https://ipwho.is/', 'https://get.geojs.io/v1/ip/geo.json'];

/**
 * Haversine distance in kilometers between two WGS84 points.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find nearest index entry to coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {IndexEntry[]} locations
 * @returns {IndexEntry | null}
 */
export function findNearestLocation(lat, lon, locations) {
  if (!locations?.length || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  let nearest = locations[0];
  let minDist = haversineKm(lat, lon, nearest.lat, nearest.lon);

  for (let i = 1; i < locations.length; i += 1) {
    const loc = locations[i];
    const dist = haversineKm(lat, lon, loc.lat, loc.lon);
    if (dist < minDist) {
      minDist = dist;
      nearest = loc;
    }
  }

  return nearest;
}

/**
 * Normalize IP geolocation API responses to { lat, lon }.
 * Rejects missing coords (avoids Number(null) → 0) and explicit API failures.
 * @param {unknown} data
 * @returns {{ lat: number; lon: number } | null}
 */
function parseIpGeoResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (data);

  if (record.success === false) return null;

  const rawLat = record.latitude ?? record.lat;
  const rawLon = record.longitude ?? record.lon ?? record.lng;
  if (rawLat == null || rawLon == null) return null;

  const lat = Number(rawLat);
  const lon = Number(rawLon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Fetch coordinates from a single IP geolocation endpoint with abort timeout.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ lat: number; lon: number } | null>}
 */
async function fetchIpGeoFrom(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return parseIpGeoResponse(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try IP geolocation APIs in order until one succeeds.
 * Failure point: third-party API timeout or CORS block.
 * Fallback: caller shows manual search UI.
 * @param {number} [timeoutMs]
 * @returns {Promise<{ lat: number; lon: number; source: string } | null>}
 */
export async function resolveIpGeolocation(timeoutMs = IP_GEO_TIMEOUT_MS) {
  for (const url of IP_GEO_ENDPOINTS) {
    const coords = await fetchIpGeoFrom(url, timeoutMs);
    if (coords) {
      return { ...coords, source: url };
    }
  }
  return null;
}

/**
 * Request browser geolocation (requires user gesture for best UX).
 * Failure point: permission denied or unavailable hardware.
 * Fallback: caller tries IP geo or search UI.
 * @returns {Promise<{ lat: number; lon: number } | null>}
 */
export function resolveBrowserGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });
}
