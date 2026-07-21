import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchOpenMeteoAq, mapOpenMeteoAqCurrent } from '../scripts/fetch/adapters/openmeteo-aq.js';

describe('mapOpenMeteoAqCurrent', () => {
  it('maps us_aqi and pm2_5 fields', () => {
    const mapped = mapOpenMeteoAqCurrent({
      pm2_5: 12.3,
      pm10: 20,
      carbon_monoxide: 100,
      nitrogen_dioxide: 8,
      sulphur_dioxide: 2,
      ozone: 40,
      european_aqi: 25,
      us_aqi: 51,
      time: '2026-07-21T12:00',
    });
    assert.deepEqual(mapped, {
      pm25: 12.3,
      pm10: 20,
      co: 100,
      no2: 8,
      so2: 2,
      o3: 40,
      european_aqi: 25,
      us_aqi: 51,
      time: '2026-07-21T12:00',
    });
  });

  it('returns null for missing current', () => {
    assert.equal(mapOpenMeteoAqCurrent(null), null);
    assert.equal(mapOpenMeteoAqCurrent(undefined), null);
  });
});

describe('fetchOpenMeteoAq with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  /** @param {number} n */
  function locs(n) {
    return Array.from({ length: n }, (_, i) => ({
      slug: `loc-${i}`,
      name: `Loc ${i}`,
      lat: 39.7 + i * 0.01,
      lon: -104.9 - i * 0.01,
      region: 'front-range',
      county: 'Denver',
      wfo: 'BOU',
      elevation_ft: 5280,
    }));
  }

  it('maps chunk results into bySlug', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          current: {
            pm2_5: 9.1,
            pm10: 15,
            us_aqi: 38,
            european_aqi: 20,
            time: '2026-07-21T13:00',
          },
        }),
      });

    const result = await fetchOpenMeteoAq(locs(1), { delayMs: 0 });
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('loc-0');
    assert.equal(row?.pm25, 9.1);
    assert.equal(row?.us_aqi, 38);
  });

  it('returns partial when some chunks fail', async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      if (call === 1) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            Array.from({ length: 40 }, () => ({
              current: { pm2_5: 10, us_aqi: 42, time: '2026-07-21T13:00' },
            })),
        });
      }
      return /** @type {Response} */ ({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
        json: async () => ({}),
      });
    };

    const result = await fetchOpenMeteoAq(locs(41), { delayMs: 0 });
    assert.equal(result.status, 'partial');
    assert.equal(result.bySlug.size, 40);
    assert.ok(result.error);
    assert.equal(result.calls, 2);
  });

  it('returns error when all chunks fail', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'boom',
        json: async () => ({}),
      });

    const result = await fetchOpenMeteoAq(locs(2), { delayMs: 0 });
    assert.equal(result.status, 'error');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /HTTP 500/);
  });
});
