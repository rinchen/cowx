import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchNws } from '../scripts/fetch/adapters/nws.js';

describe('fetchNws with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;
  /** @type {string | undefined} */
  let originalDelay;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalDelay = process.env.NWS_PRODUCT_DELAY_MS;
    process.env.NWS_PRODUCT_DELAY_MS = '0';
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (originalDelay === undefined) delete process.env.NWS_PRODUCT_DELAY_MS;
    else process.env.NWS_PRODUCT_DELAY_MS = originalDelay;
  });

  it('returns ok with alerts GeoJSON and office products', async () => {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes('/alerts/active')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-105.1, 39.6],
                      [-104.8, 39.6],
                      [-104.8, 39.9],
                      [-105.1, 39.9],
                      [-105.1, 39.6],
                    ],
                  ],
                },
                properties: {
                  event: 'Wind Advisory',
                  headline: 'Wind Advisory',
                  description: 'Gusty winds',
                  ends: '2026-07-22T18:00:00-06:00',
                  severity: 'Moderate',
                  areaDesc: 'Denver',
                  id: 'https://api.weather.gov/alerts/urn:oid:1',
                },
              },
            ],
          }),
        });
      }
      if (url.includes('/products/types/')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            '@graph': [{ id: 'https://api.weather.gov/products/abc123' }],
          }),
        });
      }
      if (url.includes('/products/')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            productText: '.DISCUSSION...Sunny today.\n$$',
            issuanceTime: '2026-07-22T12:00:00+00:00',
          }),
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await fetchNws();
    assert.equal(result.status, 'ok');
    assert.equal(result.alertsGeoJson.features.length, 1);
    assert.ok(result.byCounty.has('denver'));
    assert.ok(result.afdByWfo.size >= 1);
    assert.ok(result.hwoByWfo.size >= 1);
    assert.ok(result.fwfByWfo.size >= 1);
    // 1 alerts + 3 offices × 3 products × (list + body) = 1 + 18 = 19
    assert.equal(result.calls, 19);
    assert.equal(calls, 19);
  });

  it('counts only the list call when product id is missing', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/alerts/active')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({ features: [] }),
        });
      }
      if (url.includes('/products/types/')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({ '@graph': [{}] }),
        });
      }
      throw new Error(`unexpected product body fetch for ${url}`);
    };

    const result = await fetchNws();
    assert.equal(result.status, 'ok');
    // 1 alerts + 9 list-only product fetches
    assert.equal(result.calls, 10);
    assert.equal(result.afdByWfo.size, 0);
  });

  it('returns error when alerts and all products fail', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 503,
        text: async () => 'down',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchNws();
    assert.equal(result.status, 'error');
    assert.ok(result.error);
    assert.ok(result.calls >= 1);
  });
});
