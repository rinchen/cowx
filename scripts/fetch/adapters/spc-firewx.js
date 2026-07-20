/**
 * SPC Day 1–2 Fire Weather Outlooks (Wind/RH + DryT GeoJSON).
 * Failure point: SPC GeoJSON timeout / empty / parse failure.
 * Fallback: status error/partial; fire_weather null; empty geojson.
 */

import { fetchJson } from '../../lib/http.js';
import { CO_BBOX } from '../../lib/colorado.js';
import { pointInGeometry } from '../../lib/geometry.js';

const SOURCE_URL = 'https://www.spc.noaa.gov/products/fire_wx/overview.html';

const PRODUCT_URLS = {
  day1_windrh: 'https://www.spc.noaa.gov/products/fire_wx/day1fw_windrh.nolyr.geojson',
  day1_dryt: 'https://www.spc.noaa.gov/products/fire_wx/day1fw_dryt.nolyr.geojson',
  day2_windrh: 'https://www.spc.noaa.gov/products/fire_wx/day2fw_windrh.nolyr.geojson',
  day2_dryt: 'https://www.spc.noaa.gov/products/fire_wx/day2fw_dryt.nolyr.geojson',
};

/** @typedef {'none' | 'elevated' | 'critical' | 'extreme'} WindRhRisk */
/** @typedef {'none' | 'isolated' | 'scattered'} DryTRisk */

const WIND_RH_RANK = { none: 0, elevated: 1, critical: 2, extreme: 3 };
const DRYT_RANK = { none: 0, isolated: 1, scattered: 2 };

/**
 * @param {unknown} dn
 * @param {unknown} label
 * @returns {WindRhRisk}
 */
export function normalizeWindRh(dn, label) {
  const lab = String(label ?? '')
    .trim()
    .toLowerCase();
  if (/no\s*areas?/.test(lab) || lab === '') {
    /* fall through to DN */
  } else if (/extreme|extremely/.test(lab)) return 'extreme';
  else if (/critical/.test(lab)) return 'critical';
  else if (/elevat/.test(lab)) return 'elevated';

  const n = Number(dn);
  if (n >= 10) return 'extreme';
  if (n >= 8) return 'critical';
  if (n >= 5) return 'elevated';
  return 'none';
}

/**
 * @param {unknown} dn
 * @param {unknown} label
 * @returns {DryTRisk}
 */
export function normalizeDryT(dn, label) {
  const lab = String(label ?? '')
    .trim()
    .toLowerCase();
  if (/no\s*areas?/.test(lab) || lab === '') {
    /* fall through to DN */
  } else if (/scatter/.test(lab)) return 'scattered';
  else if (/isolat/.test(lab)) return 'isolated';

  const n = Number(dn);
  if (n >= 8) return 'scattered';
  if (n >= 5) return 'isolated';
  return 'none';
}

/**
 * @param {unknown} geometry
 * @returns {boolean}
 */
function geometryHasCoords(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  const g = /** @type {{ type?: string, coordinates?: unknown, geometries?: unknown[] }} */ (
    geometry
  );
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    return g.geometries.some((child) => geometryHasCoords(child));
  }
  if (!g.coordinates) return false;
  return JSON.stringify(g.coordinates).length > 4;
}

/**
 * True if any vertex falls near Colorado (loose pad).
 * @param {unknown} geometry
 * @returns {boolean}
 */
export function geometryTouchesColorado(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  const g = /** @type {{ type?: string, coordinates?: unknown, geometries?: unknown[] }} */ (
    geometry
  );
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    return g.geometries.some((child) => geometryTouchesColorado(child));
  }
  const flat = [];
  /**
   * @param {unknown} coords
   */
  function walk(coords) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      flat.push([coords[0], coords[1]]);
      return;
    }
    for (const c of coords) walk(c);
  }
  walk(g.coordinates);
  for (const [lon, lat] of flat) {
    if (
      lon >= CO_BBOX.west - 2 &&
      lon <= CO_BBOX.east + 2 &&
      lat >= CO_BBOX.south - 2 &&
      lat <= CO_BBOX.north + 2
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Highest Wind/RH risk at a point from a FeatureCollection.
 * @param {number} lon
 * @param {number} lat
 * @param {{ type?: string, features?: object[] } | null} fc
 * @returns {{ risk: WindRhRisk, valid: string | null, expire: string | null, issue: string | null }}
 */
export function windRhAtPoint(lon, lat, fc) {
  /** @type {WindRhRisk} */
  let best = 'none';
  let valid = null;
  let expire = null;
  let issue = null;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  for (const f of features) {
    const props = /** @type {Record<string, unknown>} */ (f?.properties ?? {});
    const risk = normalizeWindRh(props.DN, props.LABEL ?? props.LABEL2);
    if (risk === 'none') {
      if (props.VALID_ISO && !valid) valid = String(props.VALID_ISO);
      if (props.EXPIRE_ISO && !expire) expire = String(props.EXPIRE_ISO);
      if (props.ISSUE_ISO && !issue) issue = String(props.ISSUE_ISO);
      continue;
    }
    if (!geometryHasCoords(f.geometry)) continue;
    if (!pointInGeometry(lon, lat, f.geometry)) continue;
    if (WIND_RH_RANK[risk] > WIND_RH_RANK[best]) {
      best = risk;
      valid = props.VALID_ISO ? String(props.VALID_ISO) : valid;
      expire = props.EXPIRE_ISO ? String(props.EXPIRE_ISO) : expire;
      issue = props.ISSUE_ISO ? String(props.ISSUE_ISO) : issue;
    }
  }
  return { risk: best, valid, expire, issue };
}

/**
 * Highest DryT risk at a point from a FeatureCollection.
 * @param {number} lon
 * @param {number} lat
 * @param {{ type?: string, features?: object[] } | null} fc
 * @returns {DryTRisk}
 */
export function dryTAtPoint(lon, lat, fc) {
  /** @type {DryTRisk} */
  let best = 'none';
  const features = Array.isArray(fc?.features) ? fc.features : [];
  for (const f of features) {
    const props = /** @type {Record<string, unknown>} */ (f?.properties ?? {});
    const risk = normalizeDryT(props.DN, props.LABEL ?? props.LABEL2);
    if (risk === 'none') continue;
    if (!geometryHasCoords(f.geometry)) continue;
    if (!pointInGeometry(lon, lat, f.geometry)) continue;
    if (DRYT_RANK[risk] > DRYT_RANK[best]) best = risk;
  }
  return best;
}

/**
 * Clip SPC features that touch Colorado for statewide GeoJSON.
 * @param {Record<string, { type?: string, features?: object[] } | null>} products
 * @returns {{ type: string, features: object[] }}
 */
export function clipSpcToColorado(products) {
  /** @type {object[]} */
  const features = [];
  for (const [key, fc] of Object.entries(products)) {
    const list = Array.isArray(fc?.features) ? fc.features : [];
    for (const f of list) {
      if (!geometryHasCoords(f.geometry)) continue;
      if (!geometryTouchesColorado(f.geometry)) continue;
      features.push({
        type: 'Feature',
        properties: {
          ...(f.properties ?? {}),
          product: key,
        },
        geometry: f.geometry,
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, data: object | null, error?: string }>}
 */
async function loadProduct(url) {
  try {
    const data = /** @type {object} */ (await fetchJson(url, { timeoutMs: 45_000 }));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchSpcFireWx(locations) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;
  const errors = [];

  const entries = Object.entries(PRODUCT_URLS);
  /** @type {Record<string, object | null>} */
  const loaded = {};
  let okCount = 0;

  for (const [key, url] of entries) {
    const result = await loadProduct(url);
    calls += 1;
    if (result.ok && result.data) {
      loaded[key] = result.data;
      okCount += 1;
    } else {
      loaded[key] = null;
      errors.push(`${key}: ${result.error ?? 'failed'}`);
    }
  }

  if (okCount === 0) {
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'error',
      bySlug,
      fireWxGeoJson: { type: 'FeatureCollection', features: [] },
      calls,
      error: (errors.join('; ') || 'SPC fire weather GeoJSON unavailable').slice(0, 500),
    };
  }

  for (const loc of locations) {
    const d1w = windRhAtPoint(loc.lon, loc.lat, loaded.day1_windrh);
    const d2w = windRhAtPoint(loc.lon, loc.lat, loaded.day2_windrh);
    bySlug.set(loc.slug, {
      day1: {
        windRh: d1w.risk,
        dryT: dryTAtPoint(loc.lon, loc.lat, loaded.day1_dryt),
        valid: d1w.valid,
        expire: d1w.expire,
        issue: d1w.issue,
      },
      day2: {
        windRh: d2w.risk,
        dryT: dryTAtPoint(loc.lon, loc.lat, loaded.day2_dryt),
        valid: d2w.valid,
        expire: d2w.expire,
        issue: d2w.issue,
      },
      sourceUrl: SOURCE_URL,
    });
  }

  const fireWxGeoJson = clipSpcToColorado(loaded);
  const status = okCount === entries.length ? 'ok' : 'partial';

  return {
    status,
    bySlug,
    fireWxGeoJson,
    calls,
    ...(errors.length ? { error: errors.join('; ').slice(0, 500) } : {}),
  };
}
