import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  airGradientConsensus,
  fetchAirGradient,
  filterCoAirGradientSensors,
  median,
  pm25ToAqi,
} from '../scripts/fetch/adapters/airgradient.js';

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

describe('median / airGradientConsensus', () => {
  it('median handles odd and even lengths', () => {
    assert.equal(median([1, 3, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it('returns single-sensor reading without fake consensus label', () => {
    const row = airGradientConsensus([{ name: 'Solo', distanceKm: 1.2, pm25: 12 }]);
    assert.ok(row);
    assert.equal(row.pm25, 12);
    assert.equal(row.aqi_pm25, 50);
    assert.equal(row.sensor_count, 1);
    assert.equal(row.name, 'Solo');
    assert.equal(row.url, 'https://www.airgradient.com/');
    assert.equal(row.sensors.length, 1);
  });

  it('uses median and drops MAD outliers when n ≥ 3', () => {
    const row = airGradientConsensus([
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
    assert.equal(airGradientConsensus([{ name: 'X', distanceKm: 1, pm25: null }]), null);
    assert.equal(airGradientConsensus([]), null);
  });
});

describe('filterCoAirGradientSensors', () => {
  it('keeps online Colorado sensors with pm02 and drops offline / OOB', () => {
    const sensors = filterCoAirGradientSensors([
      {
        locationId: 1,
        locationName: 'Denver AG',
        latitude: 39.74,
        longitude: -104.99,
        offline: false,
        pm02: 12.5,
        rhum: 30,
        atmp: 22,
      },
      {
        locationId: 2,
        locationName: 'Offline',
        latitude: 39.75,
        longitude: -104.98,
        offline: true,
        pm02: 10,
      },
      {
        locationId: 3,
        locationName: 'Wyoming',
        latitude: 41.5,
        longitude: -104.8,
        offline: false,
        pm02: 8,
      },
      {
        locationId: 4,
        locationName: 'No PM',
        latitude: 39.7,
        longitude: -104.9,
        offline: false,
        pm02: null,
      },
    ]);
    assert.equal(sensors.length, 1);
    assert.equal(sensors[0].name, 'Denver AG');
    assert.equal(sensors[0].pm25, 12.5);
  });
});

describe('fetchAirGradient with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('builds multi-sensor consensus for a catalog location', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          {
            locationId: 1,
            locationName: 'Denver AG A',
            latitude: 39.74,
            longitude: -104.99,
            offline: false,
            pm02: 10.0,
            rhum: 30,
            atmp: 22,
          },
          {
            locationId: 2,
            locationName: 'Denver AG B',
            latitude: 39.741,
            longitude: -104.991,
            offline: false,
            pm02: 12.0,
            rhum: 31,
            atmp: 23,
          },
          {
            locationId: 3,
            locationName: 'Denver AG C',
            latitude: 39.742,
            longitude: -104.992,
            offline: false,
            pm02: 14.0,
            rhum: 32,
            atmp: 24,
          },
        ],
      });

    const result = await fetchAirGradient([
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
    ]);
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('denver');
    assert.equal(row?.sensor_count, 3);
    assert.equal(row?.pm25, 12);
    assert.equal(row?.aqi_pm25, 50);
    assert.equal(row?.name, '3 outdoor sensors');
    assert.equal(row?.url, 'https://www.airgradient.com/');
    assert.ok(Array.isArray(row?.sensors));
    assert.equal(row?.sensors?.length, 3);
    assert.equal(row?.temperature_f, 72); // 22°C → °F from nearest
  });

  it('errors when no Colorado sensors are present', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          {
            locationId: 1,
            locationName: 'Bangkok',
            latitude: 13.75,
            longitude: 100.5,
            offline: false,
            pm02: 5,
          },
        ],
      });

    const result = await fetchAirGradient([
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
    ]);
    assert.equal(result.status, 'error');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /no online AirGradient/i);
  });
});
