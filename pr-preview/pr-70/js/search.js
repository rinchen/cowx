/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */
/** @typedef {{ zip: string; lat: number; lon: number; city: string; county: string }} ZipEntry */

import { haversineKm } from './geo.js';

/**
 * @param {IndexEntry[]} locations
 * @param {ZipEntry[] | Record<string, ZipEntry>} zips
 * @param {string} query
 * @returns {IndexEntry[]}
 */
export function searchLocations(locations, zips, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (/^\d{5}$/.test(q)) {
    const list = Array.isArray(zips)
      ? zips
      : Object.entries(zips).map(([zip, v]) => ({ zip, ...v }));
    const zipHit = list.find((z) => String(z.zip) === q);
    if (!zipHit || !Number.isFinite(zipHit.lat) || !Number.isFinite(zipHit.lon)) return [];
    let best = null;
    for (const loc of locations) {
      const d = haversineKm(zipHit.lat, zipHit.lon, loc.lat, loc.lon);
      if (!best || d < best.d) best = { loc, d };
    }
    return best ? [best.loc] : [];
  }

  return locations
    .filter((loc) => {
      const name = loc.name.toLowerCase();
      const county = (loc.county ?? '').toLowerCase();
      const slug = loc.slug.toLowerCase();
      return name.includes(q) || county.includes(q) || slug.includes(q);
    })
    .slice(0, 12);
}

/**
 * @param {IndexEntry[]} locations
 * @param {string[]} favoriteSlugs
 * @returns {IndexEntry[]}
 */
export function getFavoriteLocations(locations, favoriteSlugs) {
  return favoriteSlugs.map((slug) => locations.find((l) => l.slug === slug)).filter(Boolean);
}
