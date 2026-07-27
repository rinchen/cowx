import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  fetchPurpleAir,
  median,
  pm25ToAqi,
  purpleAirConsensus,
} from '../scripts/fetch/adapters/purpleair.js';

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

describe('median / purpleAirConsensus', () => {
  it('median handles odd and even lengths', () => {
    assert.equal(median([1, 3, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it('returns single-sensor reading without fake consensus label', () => {
    const row = purpleAirConsensus([{ name: 'Solo', distanceKm: 1.2, pm25: 12 }]);
    assert.ok(row);
    assert.equal(row.pm25, 12);
    assert.equal(row.aqi_pm25, 50);
    assert.equal(row.sensor_count, 1);
    assert.equal(row.name, 'Solo');
    assert.equal(row.sensors.length, 1);
  });

  it('uses median and drops MAD outliers when n ≥ 3', () => {
    const row = purpleAirConsensus([
      { name: 'A', distanceKm: 1, pm25: 10 },
      { name: 'B', distanceKm: 2, pm25: 11 },
      { name: 'C', distanceKm: 3, pm25: 12 },
      { name: 'Outlier', distanceKm: 4, pm25: 200 },
    ]);
    assert.ok(row);
    assert.equal(row.sensor_count, 3);
    assert.equal(row.pm25, 11);
    assert.ok(!row.sensors.some((s) => s.name === 'Outlier'));
    assert.equal(row.name, '3 outdoor sensors');
  });

  it('returns null when no finite pm25', () => {
    assert.equal(purpleAirConsensus([{ name: 'X', distanceKm: 1, pm25: null }]), null);
    assert.equal(purpleAirConsensus([]), null);
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

  it('builds outdoor multi-sensor consensus when keyed', async () => {
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
            'location_type',
          ],
          data: [
            [1, 'Denver PA A', 39.74, -104.99, 10.0, 30, 72, 0],
            [2, 'Denver PA B', 39.741, -104.991, 12.0, 31, 73, 0],
            [3, 'Denver PA C', 39.742, -104.992, 14.0, 32, 74, 0],
            [4, 'Indoor junk', 39.74, -104.99, 80.0, 40, 75, 1],
          ],
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
    assert.equal(row?.sensor_count, 3);
    assert.equal(row?.pm25, 12);
    assert.equal(row?.aqi_pm25, 50);
    assert.equal(row?.name, '3 outdoor sensors');
    assert.ok(Array.isArray(row?.sensors));
    assert.equal(row?.sensors?.length, 3);
  });

  it('ignores indoor-only sensors', async () => {
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
            'location_type',
          ],
          data: [[1, 'Kitchen', 39.74, -104.99, 5.0, 30, 72, 1]],
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
    assert.equal(result.bySlug.size, 0);
  });
});
