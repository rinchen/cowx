/**
 * NIFC WFIGS current wildfire locations near Colorado catalog points.
 * Failure point: ArcGIS query timeout / empty / schema change.
 * Fallback: status error; nearby_fires null; never abort the job.
 */

import { fetchJson } from '../../lib/http.js';
import { haversineKm } from '../../lib/geo.js';

const MAX_DISTANCE_KM = 80;
const MAX_INCIDENTS = 3;
const SOURCE_URL = 'https://data-nifc.opendata.arcgis.com/';

const QUERY_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query' +
  '?where=POOState%3D%27US-CO%27' +
  '&outFields=IncidentName,POOState,PercentContained,InitialLatitude,InitialLongitude,IncidentSize,FireDiscoveryDateTime,IrwinID' +
  '&returnGeometry=true&outSR=4326&f=geojson';

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} epochMs
 * @returns {string | null}
 */
function epochToIso(epochMs) {
  const n = num(epochMs);
  if (n == null) return null;
  try {
    return new Date(n).toISOString();
  } catch {
    return null;
  }
}

/**
 * Parse WFIGS GeoJSON into incident records.
 * @param {unknown} fc
 * @returns {{ name: string, acres: number | null, percentContained: number | null, lat: number, lon: number, updated: string | null, url: string | null }[]}
 */
export function parseNifcIncidents(fc) {
  const features = /** @type {{ features?: object[] }} */ (fc)?.features;
  if (!Array.isArray(features)) return [];

  /** @type {{ name: string, acres: number | null, percentContained: number | null, lat: number, lon: number, updated: string | null, url: string | null }[]} */
  const out = [];
  for (const f of features) {
    const props = /** @type {Record<string, unknown>} */ (f?.properties ?? {});
    const geom = /** @type {{ type?: string, coordinates?: number[] }} */ (f?.geometry ?? {});
    let lat = num(props.InitialLatitude);
    let lon = num(props.InitialLongitude);
    if (
      (lat == null || lon == null) &&
      geom.type === 'Point' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length >= 2
    ) {
      lon = num(geom.coordinates[0]);
      lat = num(geom.coordinates[1]);
    }
    if (lat == null || lon == null) continue;
    const name = String(props.IncidentName ?? '').trim() || 'Unnamed incident';
    const irwin = props.IrwinID ? String(props.IrwinID) : null;
    out.push({
      name,
      acres: num(props.IncidentSize),
      percentContained: num(props.PercentContained),
      lat,
      lon,
      updated: epochToIso(props.FireDiscoveryDateTime),
      url: irwin
        ? `https://inciweb.wildfire.gov/incident-information/search?query=${encodeURIComponent(name)}`
        : 'https://inciweb.wildfire.gov/',
    });
  }
  return out;
}

/**
 * Rank incidents near a point (within maxKm, capped).
 * @param {{ lat: number, lon: number }} target
 * @param {{ name: string, acres: number | null, percentContained: number | null, lat: number, lon: number, updated: string | null, url: string | null }[]} incidents
 * @param {number} [maxKm]
 * @param {number} [limit]
 */
export function nearestIncidents(
  target,
  incidents,
  maxKm = MAX_DISTANCE_KM,
  limit = MAX_INCIDENTS,
) {
  return incidents
    .map((inc) => ({
      ...inc,
      distance_km: Math.round(haversineKm(target, inc) * 10) / 10,
    }))
    .filter((inc) => inc.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchNifcFires(locations) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;

  try {
    const fc = await fetchJson(QUERY_URL, { timeoutMs: 60_000 });
    calls += 1;
    const incidents = parseNifcIncidents(fc);

    for (const loc of locations) {
      const nearby = nearestIncidents(loc, incidents);
      bySlug.set(loc.slug, {
        incidents: nearby,
        sourceUrl: SOURCE_URL,
      });
    }

    return {
      status: 'ok',
      bySlug,
      calls,
    };
  } catch (err) {
    calls += 1;
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'error',
      bySlug,
      calls,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }
}
