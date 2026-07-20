const EARTH_RADIUS_KM = 6371;

/**
 * @typedef {{ lat: number; lon: number; [key: string]: unknown }} GeoPoint
 */

/**
 * Convert degrees to radians.
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
 * Assign nearest candidate within maxKm to each location.
 * @template T
 * @param {{ slug: string, lat: number, lon: number }[]} locations
 * @param {GeoPoint[]} candidates
 * @param {number} maxKm
 * @param {(nearest: { point: GeoPoint, distanceKm: number }, loc: { slug: string, lat: number, lon: number }) => T | null} mapFn
 * @returns {Map<string, T>}
 */
export function assignNearestWithin(locations, candidates, maxKm, mapFn) {
  /** @type {Map<string, T>} */
  const bySlug = new Map();
  for (const loc of locations) {
    const nearest = nearestPoint(loc, candidates);
    if (!nearest || nearest.distanceKm > maxKm) continue;
    const mapped = mapFn(nearest, loc);
    if (mapped != null) bySlug.set(loc.slug, mapped);
  }
  return bySlug;
}
