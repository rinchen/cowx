/**
 * NWS alerts + Area Forecast Discussion adapter.
 * Failure point: 403 without User-Agent, timeouts.
 * Fallback: empty alerts / no AFD; status error/partial.
 */

import { fetchJson, NWS_USER_AGENT } from '../../lib/http.js';

const OFFICES = ['BOU', 'PUB', 'GJT'];

/**
 * @returns {Promise<{ status: string, alertsGeoJson: object, byCounty: Map<string, object[]>, afdByWfo: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchNws() {
  let calls = 0;
  const errors = [];
  /** @type {Map<string, object[]>} */
  const byCounty = new Map();
  /** @type {Map<string, object>} */
  const afdByWfo = new Map();
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

      const summary = {
        event,
        headline,
        description,
        ends,
        severity,
        areaDesc: areas,
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
      calls += 1;
      const list = await fetchJson(
        `https://api.weather.gov/products/types/AFD/locations/${office}`,
        { headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/ld+json' } },
      );
      const first = list?.['@graph']?.[0];
      const productId = first?.id ?? first?.['@id'];
      if (!productId) continue;
      const productUrl = String(productId).startsWith('http')
        ? String(productId)
        : `https://api.weather.gov/products/${productId}`;
      calls += 1;
      const product = await fetchJson(productUrl, {
        headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/ld+json' },
      });
      const text = String(product?.productText ?? '');
      const synopsisMatch = text.match(/\.SYNOPSIS[\s\S]*?(?=\n\.[A-Z]|\n\$\$|$)/i);
      const snippet = (synopsisMatch?.[0] ?? text).replace(/\s+/g, ' ').trim().slice(0, 400);
      afdByWfo.set(office, {
        office,
        issued: product?.issuanceTime ?? null,
        snippet,
        url: `https://forecast.weather.gov/product.php?site=${office}&issuedby=${office}&product=AFD&format=CI`,
      });
    } catch (err) {
      errors.push(`${office}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const okAlerts = errors.length === 0 || byCounty.size > 0 || alertsGeoJson.features.length > 0;
  const status = errors.length === 0 ? 'ok' : okAlerts || afdByWfo.size > 0 ? 'partial' : 'error';

  return {
    status,
    alertsGeoJson,
    byCounty,
    afdByWfo,
    error: errors.length ? errors.join('; ') : undefined,
    calls,
  };
}
