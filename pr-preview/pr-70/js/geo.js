import { isInColorado } from './geocode.js';
import { haversineKm as haversineKmPoints, nearestPoint, roundKm } from './geo-math.js';

/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string; elevationFt?: number }} IndexEntry */

/** @typedef {{ lat: number; lon: number; accuracy_m: number | null; at: string; source: 'gps' | 'ip' | 'address'; label?: string }} HyperlocalPin */

const IP_GEO_TIMEOUT_MS = 5000;
const IP_GEO_ENDPOINTS = ['https://ipwho.is/', 'https://get.geojs.io/v1/ip/geo.json'];
const PIN_STORAGE_KEY = 'cowx:hyperlocalPin';
/** Cap stored pin labels (Nominatim display_name can be very long). */
const PIN_LABEL_MAX = 200;

/**
 * @param {unknown} label
 * @returns {string | undefined}
 */
function sanitizePinLabel(label) {
  if (typeof label !== 'string') return undefined;
  let cleaned = '';
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue;
    cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, PIN_LABEL_MAX);
  return cleaned || undefined;
}

/**
 * Haversine distance in kilometers between two WGS84 points (legacy 4-arg form).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  return haversineKmPoints({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
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
  const nearest = nearestPoint({ lat, lon }, locations);
  return nearest ? /** @type {IndexEntry} */ (nearest.point) : null;
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
  return roundKm(haversineKmPoints(pin, { lat, lon }));
}

/**
 * Persist hyperlocal pin in this browser (localStorage).
 * Survives refresh and new tabs on the same origin; cleared when the user
 * searches a catalog city or clears site data.
 * @param {HyperlocalPin} pin
 */
export function setHyperlocalPin(pin) {
  if (!pin || !isInColorado(pin.lat, pin.lon)) return;
  try {
    const safe = {
      ...pin,
      label: sanitizePinLabel(pin.label),
    };
    const raw = JSON.stringify(safe);
    localStorage.setItem(PIN_STORAGE_KEY, raw);
    try {
      sessionStorage.removeItem(PIN_STORAGE_KEY);
    } catch {
      /* ignore legacy session key cleanup */
    }
  } catch {
    /* private mode / quota */
  }
}

/**
 * @returns {HyperlocalPin | null}
 */
export function getHyperlocalPin() {
  try {
    let raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) {
      // Migrate one-time from older session-only pins so a refresh mid-upgrade keeps them.
      try {
        raw = sessionStorage.getItem(PIN_STORAGE_KEY);
        if (raw) {
          localStorage.setItem(PIN_STORAGE_KEY, raw);
          sessionStorage.removeItem(PIN_STORAGE_KEY);
        }
      } catch {
        raw = null;
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const lat = Number(parsed.lat);
    const lon = Number(parsed.lon);
    if (!isInColorado(lat, lon)) {
      clearHyperlocalPin();
      return null;
    }
    /** @type {HyperlocalPin['source']} */
    let source = 'gps';
    if (parsed.source === 'ip') source = 'ip';
    else if (parsed.source === 'address') source = 'address';
    return {
      lat,
      lon,
      accuracy_m:
        parsed.accuracy_m != null && Number.isFinite(Number(parsed.accuracy_m))
          ? Number(parsed.accuracy_m)
          : null,
      at: typeof parsed.at === 'string' ? parsed.at : new Date().toISOString(),
      source,
      label: sanitizePinLabel(parsed.label),
    };
  } catch {
    return null;
  }
}

/**
 * Clear saved pin (e.g. user navigates via search without locate).
 */
export function clearHyperlocalPin() {
  try {
    localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
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
