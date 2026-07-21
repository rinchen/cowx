import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchPurpleAir, pm25ToAqi } from '../scripts/fetch/adapters/purpleair.js';

describe('pm25ToAqi', () => {
  it('maps known EPA breakpoints', () => {
    assert.equal(pm25ToAqi(0), 0);
    assert.equal(pm25ToAqi(12), 50);
    assert.equal(pm25ToAqi(35.4), 100);
    assert.equal(pm25ToAqi(55.4), 150);
    assert.equal(pm25ToAqi(150.4), 200);
  });

  it('returns null for invalid input and caps extreme values', () => {
    assert.equal(pm25ToAqi(null), null);
    assert.equal(pm25ToAqi(Number.NaN), null);
    assert.equal(pm25ToAqi(600), 500);
  });
});

describe('fetchPurpleAir', () => {
  it('skips when API key is missing', async () => {
    const result = await fetchPurpleAir([{ slug: 'denver', lat: 39.74, lon: -104.99 }], {});
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /PURPLEAIR_API_KEY/);
  });
});

describe('fetchPurpleAir with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('assigns nearest sensor within 25 km when keyed', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          fields: [
            'sensor_index',
            'name',
            'latitude',
            'longitude',
            'pm2.5_10minute',
            'humidity',
            'temperature',
          ],
          data: [[1, 'Denver PA', 39.74, -104.99, 12.0, 30, 72]],
        }),
      });

    const result = await fetchPurpleAir(
      [
        {
          slug: 'denver',
          name: 'Denver',
          lat: 39.74,
          lon: -104.99,
          region: 'front-range',
          county: 'Denver',
          wfo: 'BOU',
          elevation_ft: 5280,
        },
      ],
      { PURPLEAIR_API_KEY: 'test-key' },
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('denver');
    assert.equal(row?.name, 'Denver PA');
    assert.equal(row?.pm25, 12);
    assert.equal(row?.aqi_pm25, 50);
  });
});
