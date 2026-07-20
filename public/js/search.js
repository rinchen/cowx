/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */
/** @typedef {{ zip: string; lat: number; lon: number; city: string; county: string }} ZipEntry */

/**
 * Haversine distance km.
 * @param {{ lat: number; lon: number }} a
 * @param {{ lat: number; lon: number }} b
 */
function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

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
      const d = haversineKm(zipHit, loc);
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
