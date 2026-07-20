/**
 * GeoJSON point-in-polygon helpers (lon/lat, ray casting).
 */

/**
 * Ray-cast point-in-ring (lon/lat). Ring is [[lon,lat], ...] (GeoJSON order).
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {{ type?: string, coordinates?: unknown }} geometry
 * @returns {boolean}
 */
export function pointInGeometry(lon, lat, geometry) {
  if (!geometry?.type || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    const rings = /** @type {number[][][]} */ (geometry.coordinates);
    if (!rings[0] || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(lon, lat, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = /** @type {number[][][][]} */ (geometry.coordinates);
    return polys.some((poly) => pointInGeometry(lon, lat, { type: 'Polygon', coordinates: poly }));
  }
  return false;
}
