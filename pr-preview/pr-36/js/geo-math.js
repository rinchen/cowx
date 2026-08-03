/**
 * Shared geo math for client + fetch (static Pages has no bundler).
 * Prefer object-form lat/lon points. scripts/lib/geo.js re-exports this module.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * @typedef {{ lat: number; lon: number; [key: string]: unknown }} GeoPoint
 */

/**
 * @param {number} degrees
 * @returns {number}
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine distance between two points in kilometers.
 * @param {{ lat: number; lon: number }} a
 * @param {{ lat: number; lon: number }} b
 * @returns {number}
 */
export function haversineKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Round distance to one decimal place (km).
 * @param {number} d
 * @returns {number}
 */
export function roundKm(d) {
  return Math.round(d * 10) / 10;
}

/**
 * Find the nearest point to a target from a list of candidates.
 * @param {{ lat: number; lon: number }} target
 * @param {GeoPoint[]} candidates
 * @returns {{ point: GeoPoint; distanceKm: number } | null}
 */
export function nearestPoint(target, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  let best = null;
  for (const point of candidates) {
    const distanceKm = haversineKm(target, point);
    if (!best || distanceKm < best.distanceKm) {
      best = { point, distanceKm };
    }
  }
  return best;
}

/**
 * Nearest candidates sorted by distance (ascending), capped at `limit`.
 * @param {{ lat: number; lon: number }} target
 * @param {GeoPoint[]} candidates
 * @param {number} [limit=3]
 * @returns {{ point: GeoPoint; distanceKm: number }[]}
 */
export function nearestPoints(target, candidates, limit = 3) {
  if (!Array.isArray(candidates) || candidates.length === 0 || limit <= 0) {
    return [];
  }
  return candidates
    .map((point) => ({ point, distanceKm: haversineKm(target, point) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/**
 * Rank candidates within maxKm, sorted by distance, capped at limit.
 * Returns shallow copies of each candidate with `distance_km` attached.
 * @template {Record<string, unknown>} T
 * @param {{ lat: number; lon: number }} target
 * @param {T[]} candidates
 * @param {{ maxKm?: number, limit?: number }} [opts]
 * @returns {(T & { distance_km: number })[]}
 */
export function rankWithinKm(target, candidates, opts = {}) {
  const maxKm = opts.maxKm ?? Infinity;
  const limit = opts.limit ?? candidates.length;
  if (!Array.isArray(candidates) || candidates.length === 0 || limit <= 0) {
    return [];
  }
  return candidates
    .map((c) => ({
      ...c,
      distance_km: roundKm(haversineKm(target, /** @type {{ lat: number, lon: number }} */ (c))),
    }))
    .filter((c) => c.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}
