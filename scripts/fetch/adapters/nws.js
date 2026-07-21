/**
 * NWS alerts + Area Forecast Discussion + Hazardous Weather Outlook adapter.
 * Failure point: 403 without User-Agent, timeouts.
 * Fallback: empty alerts / no AFD/HWO; status error/partial.
 */

import { fetchJson, NWS_USER_AGENT } from '../../lib/http.js';
import { pointInGeometry, pointInRing } from '../../lib/geometry.js';

export { pointInGeometry, pointInRing };

const OFFICES = ['BOU', 'PUB', 'GJT'];

/**
 * Merge county-matched alerts with geometry-contains matches (dedupe by id/event+ends).
 * @param {number} lat
 * @param {number} lon
 * @param {string} countyKey
 * @param {Map<string, object[]>} byCounty
 * @param {{ features?: object[] }} alertsGeoJson
 * @returns {object[]}
 */
export function alertsForLocation(lat, lon, countyKey, byCounty, alertsGeoJson) {
  /** @type {Map<string, object>} */
  const byKey = new Map();
  const add = (/** @type {object} */ a) => {
    const key = String(a.id ?? `${a.event}|${a.ends}|${a.headline}`);
    if (!byKey.has(key)) byKey.set(key, a);
  };

  for (const a of byCounty.get(String(countyKey).toLowerCase()) ?? []) add(a);

  const features = Array.isArray(alertsGeoJson?.features) ? alertsGeoJson.features : [];
  for (const f of features) {
    if (!f?.geometry) continue;
    if (!pointInGeometry(lon, lat, f.geometry)) continue;
    const props = f.properties ?? f;
    add(props);
  }

  return [...byKey.values()];
}

/**
 * Resolve an NWS product id or URL to an allowlisted api.weather.gov HTTPS URL.
 * @param {unknown} productId
 * @returns {string | null}
 */
export function resolveNwsProductUrl(productId) {
  if (productId == null) return null;
  const raw = String(productId).trim();
  if (!raw) return null;
  if (!raw.startsWith('http')) {
    // Product ids are opaque path segments (e.g. UUID-like); reject path tricks.
    if (raw.includes('/') || raw.includes('..') || /\s/.test(raw)) return null;
    return `https://api.weather.gov/products/${encodeURIComponent(raw)}`;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'api.weather.gov') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * @param {string} office
 * @param {'AFD' | 'HWO'} productType
 * @returns {Promise<{ office: string, issued: string | null, snippet: string, url: string } | null>}
 */
async function fetchOfficeProduct(office, productType) {
  const list = await fetchJson(
    `https://api.weather.gov/products/types/${productType}/locations/${office}`,
    {
      headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/ld+json' },
      timeoutMs: 45_000,
    },
  );
  const first = list?.['@graph']?.[0];
  const productId = first?.id ?? first?.['@id'];
  const productUrl = resolveNwsProductUrl(productId);
  if (!productUrl) return null;
  const product = await fetchJson(productUrl, {
    headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/ld+json' },
    timeoutMs: 45_000,
  });
  const text = String(product?.productText ?? '');
  let snippet;
  if (productType === 'AFD') {
    const synopsisMatch = text.match(/\.SYNOPSIS[\s\S]*?(?=\n\.[A-Z]|\n\$\$|$)/i);
    snippet = (synopsisMatch?.[0] ?? text).replace(/\s+/g, ' ').trim().slice(0, 400);
  } else {
    snippet = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  return {
    office,
    issued: product?.issuanceTime ?? null,
    snippet,
    url: `https://forecast.weather.gov/product.php?site=${office}&issuedby=${office}&product=${productType}&format=CI`,
  };
}

/**
 * @returns {Promise<{
 *   status: string,
 *   alertsGeoJson: object,
 *   byCounty: Map<string, object[]>,
 *   afdByWfo: Map<string, object>,
 *   hwoByWfo: Map<string, object>,
 *   error?: string,
 *   calls: number
 * }>}
 */
export async function fetchNws() {
  let calls = 0;
  const errors = [];
  /** @type {Map<string, object[]>} */
  const byCounty = new Map();
  /** @type {Map<string, object>} */
  const afdByWfo = new Map();
  /** @type {Map<string, object>} */
  const hwoByWfo = new Map();
  let alertsGeoJson = { type: 'FeatureCollection', features: [] };

  try {
    calls += 1;
    const alerts = await fetchJson('https://api.weather.gov/alerts/active?area=CO', {
      headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' },
      timeoutMs: 45_000,
    });

    const features = Array.isArray(alerts?.features) ? alerts.features : [];
    const withGeom = [];

    for (const f of features) {
      const props = f.properties ?? {};
      const event = props.event ?? 'Alert';
      const headline = props.headline ?? '';
      const description = props.description ?? '';
      const ends = props.ends ?? props.expires ?? null;
      const severity = props.severity ?? null;
      const areas = props.areaDesc ?? '';

      const rawId = props.id ?? props['@id'] ?? null;
      const url =
        rawId == null
          ? null
          : String(rawId).startsWith('http')
            ? String(rawId)
            : `https://api.weather.gov/alerts/${rawId}`;

      const summary = {
        event,
        headline,
        description,
        ends,
        severity,
        areaDesc: areas,
        id: rawId != null ? String(rawId) : null,
        url,
      };

      for (const part of String(areas).split(';')) {
        const county = part.replace(/ County$/i, '').trim();
        if (!county) continue;
        const key = county.toLowerCase();
        if (!byCounty.has(key)) byCounty.set(key, []);
        byCounty.get(key).push(summary);
      }

      if (f.geometry) {
        withGeom.push({
          type: 'Feature',
          geometry: f.geometry,
          properties: summary,
        });
      }
    }

    alertsGeoJson = { type: 'FeatureCollection', features: withGeom };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const office of OFFICES) {
    try {
      const afd = await fetchOfficeProduct(office, 'AFD');
      calls += 2;
      if (afd) afdByWfo.set(office, afd);
    } catch (err) {
      calls += 1;
      errors.push(`AFD ${office}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const hwo = await fetchOfficeProduct(office, 'HWO');
      calls += 2;
      if (hwo) hwoByWfo.set(office, hwo);
    } catch (err) {
      calls += 1;
      errors.push(`HWO ${office}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const okAlerts = errors.length === 0 || byCounty.size > 0 || alertsGeoJson.features.length > 0;
  const status =
    errors.length === 0
      ? 'ok'
      : okAlerts || afdByWfo.size > 0 || hwoByWfo.size > 0
        ? 'partial'
        : 'error';

  return {
    status,
    alertsGeoJson,
    byCounty,
    afdByWfo,
    hwoByWfo,
    error: errors.length ? errors.join('; ') : undefined,
    calls,
  };
}
