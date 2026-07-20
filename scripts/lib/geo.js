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
