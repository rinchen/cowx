/**
 * Shared geo helpers for fetch adapters.
 * Canonical math lives in public/js/geo-math.js (static Pages has no bundler).
 */

import { nearestPoint } from '../../public/js/geo-math.js';

export {
  fmtDistanceMi,
  haversineKm,
  nearestPoint,
  nearestPoints,
  rankWithinKm,
  roundKm,
} from '../../public/js/geo-math.js';

/**
 * @typedef {{ lat: number; lon: number; [key: string]: unknown }} GeoPoint
 */

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
