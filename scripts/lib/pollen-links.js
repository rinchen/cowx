/**
 * Offsite pollen / allergy health links for Colorado locations (no live pollen API).
 */

import { nearestPoint } from './geo.js';

/** Statewide NAB / AAAAI reference links (same for every location). */
export const NAB_COLORADO_LINKS = [
  {
    name: 'AAAAI National Allergy Bureau map',
    url: 'https://pollen.aaaai.org/',
  },
  {
    name: 'NAB pollen count overview',
    url: 'https://www.aaaai.org/conditions-and-treatments/library/allergy-library/national-allergy-bureau-pollen-count',
  },
];

/**
 * @param {string} zip
 * @returns {string}
 */
export function pollenComUrlForZip(zip) {
  const z = String(zip).replace(/\D/g, '').slice(0, 5);
  return `https://www.pollen.com/forecast/current/pollen/${encodeURIComponent(z)}`;
}

/**
 * @param {{ lat: number, lon: number }} loc
 * @param {{ zip: string, lat: number, lon: number, city?: string }[]} zipPoints
 * @returns {{ zip: string, city: string | null, distance_km: number, url: string } | null}
 */
export function nearestPollenLink(loc, zipPoints) {
  const nearest = nearestPoint(loc, zipPoints);
  if (!nearest) return null;
  const zip = String(nearest.point.zip ?? '');
  if (!/^\d{5}$/.test(zip)) return null;
  return {
    zip,
    city: nearest.point.city != null ? String(nearest.point.city) : null,
    distance_km: Math.round(nearest.distanceKm * 10) / 10,
    url: pollenComUrlForZip(zip),
  };
}

/**
 * Build pollen/health link fields for a location payload.
 * @param {{ lat: number, lon: number }} loc
 * @param {{ zip: string, lat: number, lon: number, city?: string }[]} zipPoints
 * @returns {{
 *   pollen: string | null,
 *   pollen_zip: string | null,
 *   pollen_city: string | null,
 *   nab_links: { name: string, url: string }[],
 * }}
 */
export function buildPollenHealthLinks(loc, zipPoints) {
  const nearest = nearestPollenLink(loc, zipPoints);
  return {
    pollen: nearest?.url ?? null,
    pollen_zip: nearest?.zip ?? null,
    pollen_city: nearest?.city ?? null,
    nab_links: NAB_COLORADO_LINKS.map((l) => ({ ...l })),
  };
}
