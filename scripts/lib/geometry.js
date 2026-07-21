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
  /** @type {number[][]} */
  const pts = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([x, y]);
  }
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const denom = yj - yi || Number.EPSILON;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / denom + xi;
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
