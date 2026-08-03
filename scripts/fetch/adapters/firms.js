/**
 * NASA FIRMS VIIRS active-fire detections near Colorado catalog points.
 * Failure point: missing MAP_KEY, HTTP/CSV parse failure.
 * Fallback: status skipped/error; nearby_firms null; empty geojson.
 */

import { fetchWithTimeout, sanitizeErrorMessage } from '../../lib/http.js';
import { rankWithinKm } from '../../lib/geo.js';
import { CO_BBOX } from '../../lib/colorado.js';
import { toFiniteNumber } from '../../lib/parse.js';

const MAX_DISTANCE_KM = 80;
const MAX_HOTSPOTS = 5;
const SOURCE_URL = 'https://firms.modaps.eosdis.nasa.gov/';
const DISCLAIMER =
  'NASA FIRMS active-fire detections are satellite thermal anomalies, not confirmed wildfire incidents. Verify with NIFC / local authorities.';

/** CO west,south,east,north for FIRMS area API. */
const AREA = `${CO_BBOX.west},${CO_BBOX.south},${CO_BBOX.east},${CO_BBOX.north}`;

/**
 * Redact MAP_KEY path segment from FIRMS URLs in error text.
 * @param {string} url
 * @param {string} key
 * @returns {string}
 */
export function redactFirmsUrl(url, key) {
  let s = String(url ?? '');
  if (key) s = s.split(key).join('[redacted]');
  return sanitizeErrorMessage(s);
}

/**
 * Parse FIRMS area CSV into hotspot records.
 * @param {string} csv
 * @returns {{ lat: number, lon: number, brightness: number | null, frp: number | null, confidence: string | null, observed: string | null, satellite: string | null }[]}
 */
export function parseFirmsCsv(csv) {
  const text = String(csv ?? '').trim();
  if (!text || /^Invalid MAP_KEY/i.test(text) || /^Error/i.test(text)) return [];

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const latIdx = headers.indexOf('latitude');
  const lonIdx = headers.indexOf('longitude');
  if (latIdx < 0 || lonIdx < 0) return [];

  const brightIdx =
    headers.indexOf('bright_ti4') >= 0
      ? headers.indexOf('bright_ti4')
      : headers.indexOf('brightness');
  const frpIdx = headers.indexOf('frp');
  const confIdx = headers.indexOf('confidence');
  const dateIdx = headers.indexOf('acq_date');
  const timeIdx = headers.indexOf('acq_time');
  const satIdx = headers.indexOf('satellite');

  /** @type {{ lat: number, lon: number, brightness: number | null, frp: number | null, confidence: string | null, observed: string | null, satellite: string | null }[]} */
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    const lat = toFiniteNumber(cols[latIdx]);
    const lon = toFiniteNumber(cols[lonIdx]);
    if (lat == null || lon == null) continue;

    const date = dateIdx >= 0 ? String(cols[dateIdx] ?? '').trim() : '';
    const timeRaw =
      timeIdx >= 0
        ? String(cols[timeIdx] ?? '')
            .trim()
            .padStart(4, '0')
        : '';
    let observed = null;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}$/.test(timeRaw)) {
      observed = `${date}T${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}:00Z`;
    } else if (date) {
      observed = date;
    }

    const confRaw = confIdx >= 0 ? String(cols[confIdx] ?? '').trim() : '';
    out.push({
      lat,
      lon,
      brightness: brightIdx >= 0 ? toFiniteNumber(cols[brightIdx]) : null,
      frp: frpIdx >= 0 ? toFiniteNumber(cols[frpIdx]) : null,
      confidence: confRaw || null,
      observed,
      satellite: satIdx >= 0 ? String(cols[satIdx] ?? '').trim() || null : null,
    });
  }
  return out;
}

/**
 * Rank hotspots near a point.
 * @param {{ lat: number, lon: number }} target
 * @param {{ lat: number, lon: number, brightness: number | null, frp: number | null, confidence: string | null, observed: string | null, satellite: string | null }[]} hotspots
 * @param {number} [maxKm]
 * @param {number} [limit]
 */
export function nearestHotspots(target, hotspots, maxKm = MAX_DISTANCE_KM, limit = MAX_HOTSPOTS) {
  return rankWithinKm(target, hotspots, { maxKm, limit });
}

/**
 * Build statewide GeoJSON FeatureCollection from hotspots.
 * @param {{ lat: number, lon: number, brightness: number | null, frp: number | null, confidence: string | null, observed: string | null, satellite: string | null }[]} hotspots
 */
export function hotspotsToGeoJson(hotspots) {
  return {
    type: 'FeatureCollection',
    features: hotspots.map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
      properties: {
        brightness: h.brightness,
        frp: h.frp,
        confidence: h.confidence,
        observed: h.observed,
        satellite: h.satellite,
      },
    })),
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function fetchFirms(locations, env = process.env) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;
  const key = String(env.FIRMS_MAP_KEY ?? '').trim();

  if (!key) {
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'skipped',
      bySlug,
      firmsGeoJson: { type: 'FeatureCollection', features: [] },
      calls,
      error: 'FIRMS_MAP_KEY not set',
    };
  }

  const url =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}` +
    `/VIIRS_SNPP_NRT/${AREA}/1`;

  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 60_000, retries: 2 });
    calls += 1;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${redactFirmsUrl(url, key)}`);
    }
    const csv = await res.text();
    if (/^Invalid MAP_KEY/i.test(csv.trim())) {
      throw new Error('Invalid FIRMS_MAP_KEY');
    }
    const hotspots = parseFirmsCsv(csv);

    for (const loc of locations) {
      const nearby = nearestHotspots(loc, hotspots);
      bySlug.set(loc.slug, {
        hotspots: nearby,
        sourceUrl: SOURCE_URL,
        disclaimer: DISCLAIMER,
      });
    }

    return {
      status: 'ok',
      bySlug,
      firmsGeoJson: hotspotsToGeoJson(hotspots),
      calls,
    };
  } catch (err) {
    calls += 1;
    for (const loc of locations) bySlug.set(loc.slug, null);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      bySlug,
      firmsGeoJson: { type: 'FeatureCollection', features: [] },
      calls,
      error: sanitizeErrorMessage(redactFirmsUrl(msg, key)).slice(0, 500),
    };
  }
}
