/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string; elevationFt?: number }} IndexEntry */

/** @typedef {{ lat: number; lon: number; accuracy_m: number | null; at: string; source: 'gps' | 'ip' }} HyperlocalPin */

const EARTH_RADIUS_KM = 6371;
const IP_GEO_TIMEOUT_MS = 5000;
const IP_GEO_ENDPOINTS = ['https://ipwho.is/', 'https://get.geojs.io/v1/ip/geo.json'];
const PIN_STORAGE_KEY = 'cowx:hyperlocalPin';

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
 * Distance from pin to a catalog entry (km), or null.
 * @param {HyperlocalPin | null | undefined} pin
 * @param {{ lat?: unknown, lon?: unknown } | null | undefined} loc
 * @returns {number | null}
 */
export function pinDistanceKm(pin, loc) {
  if (!pin || loc?.lat == null || loc?.lon == null) return null;
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return Math.round(haversineKm(pin.lat, pin.lon, lat, lon) * 10) / 10;
}

/**
 * Persist hyperlocal pin for this browser tab session only.
 * @param {HyperlocalPin} pin
 */
export function setHyperlocalPin(pin) {
  try {
    sessionStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pin));
  } catch {
    /* private mode / quota */
  }
}

/**
 * @returns {HyperlocalPin | null}
 */
export function getHyperlocalPin() {
  try {
    const raw = sessionStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const lat = Number(parsed.lat);
    const lon = Number(parsed.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      accuracy_m:
        parsed.accuracy_m != null && Number.isFinite(Number(parsed.accuracy_m))
          ? Number(parsed.accuracy_m)
          : null,
      at: typeof parsed.at === 'string' ? parsed.at : new Date().toISOString(),
      source: parsed.source === 'ip' ? 'ip' : 'gps',
    };
  } catch {
    return null;
  }
}

/**
 * Clear session pin (e.g. user navigates via search without locate).
 */
export function clearHyperlocalPin() {
  try {
    sessionStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
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
 * @param {{ highAccuracy?: boolean }} [opts]
 * @returns {Promise<{ lat: number; lon: number; accuracy_m: number | null } | null>}
 */
export function resolveBrowserGeolocation(opts = {}) {
  const highAccuracy = opts.highAccuracy !== false;
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy =
          typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null;
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: accuracy,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 20000 : 15000,
        maximumAge: highAccuracy ? 60_000 : 300_000,
      },
    );
  });
}
