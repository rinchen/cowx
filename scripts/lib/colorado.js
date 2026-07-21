/**
 * Shared Colorado bounding box for fetch adapters.
 * Keep in sync with public/js/geocode.js for client checks.
 * validate-locations.js uses a slightly stricter west lon (-109.15 vs -109.2) intentionally.
 */

/** Rough Colorado bounding box (same as HMS / SPC padding sources). */
export const CO_BBOX = { west: -109.2, south: 36.9, east: -102.0, north: 41.1 };

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
