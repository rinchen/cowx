/**
 * Colorado-bounded address geocoding via OSM Nominatim (keyless, user-triggered).
 * Failure point: network / rate limit / out-of-state result.
 * Fallback: caller keeps catalog search; no pin set.
 */

/** Rough Colorado bounding box (same as catalog validator). */
export const CO_BBOX = {
  west: -109.2,
  south: 36.9,
  east: -102.0,
  north: 41.1,
};

const GEOCODE_TIMEOUT_MS = 12_000;
/** Cap query length before hitting Nominatim (UI maxlength should match). */
export const GEOCODE_MAX_QUERY_LENGTH = 200;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const LABEL_MAX = 200;

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isInColorado(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= CO_BBOX.south &&
    lat <= CO_BBOX.north &&
    lon >= CO_BBOX.west &&
    lon <= CO_BBOX.east
  );
}

/**
 * Pick first Nominatim hit inside Colorado.
 * @param {unknown} raw
 * @returns {{ lat: number, lon: number, label: string } | null}
 */
export function pickColoradoNominatimResult(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = /** @type {Record<string, unknown>} */ (item);
    const lat = Number(rec.lat);
    const lon = Number(rec.lon);
    if (!isInColorado(lat, lon)) continue;
    const label =
      typeof rec.display_name === 'string' && rec.display_name.trim()
        ? rec.display_name.trim().slice(0, LABEL_MAX)
        : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    return { lat, lon, label };
  }
  return null;
}

/**
 * @typedef {{ ok: true, lat: number, lon: number, label: string }} GeocodeOk
 * @typedef {{ ok: false, reason: 'invalid' | 'http' | 'timeout' | 'network' | 'empty' }} GeocodeFail
 */

/**
 * Geocode a Colorado street address / place (explicit user submit only).
 * Browser sends Referer; do not set forbidden User-Agent headers.
 * @param {string} query
 * @returns {Promise<GeocodeOk | GeocodeFail>}
 */
export async function geocodeColoradoAddress(query) {
  const q = String(query ?? '').trim();
  if (q.length < 3 || q.length > GEOCODE_MAX_QUERY_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }

  const params = new URLSearchParams({
    q,
    format: 'json',
    limit: '5',
    countrycodes: 'us',
    viewbox: `${CO_BBOX.west},${CO_BBOX.north},${CO_BBOX.east},${CO_BBOX.south}`,
    bounded: '1',
    addressdetails: '0',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn('geocode: Nominatim HTTP', res.status);
      return { ok: false, reason: 'http' };
    }
    const json = await res.json();
    const hit = pickColoradoNominatimResult(json);
    if (!hit) return { ok: false, reason: 'empty' };
    return { ok: true, ...hit };
  } catch (err) {
    const aborted =
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof DOMException !== 'undefined' &&
        err instanceof DOMException &&
        err.name === 'AbortError');
    if (aborted) {
      console.warn('geocode: Nominatim timeout');
      return { ok: false, reason: 'timeout' };
    }
    console.warn('geocode: Nominatim network error', err);
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
