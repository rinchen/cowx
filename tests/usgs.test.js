import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignNearestGauges,
  celsiusToFahrenheit,
  fetchUsgs,
  parseNwisIv,
} from '../scripts/fetch/adapters/usgs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usgsFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/usgs-iv-sample.json'), 'utf8'),
);

describe('usgs helpers', () => {
  it('converts celsius to fahrenheit', () => {
    assert.equal(celsiusToFahrenheit(0), 32);
    assert.equal(celsiusToFahrenheit(10), 50);
    assert.equal(celsiusToFahrenheit(null), null);
  });

  it('parses NWIS IV series into gauge rows', () => {
    const data = {
      value: {
        timeSeries: [
          {
            sourceInfo: {
              siteName: 'CACHE LA POUDRE RIV AT CANYON MOUTH NR FT COLLINS',
              siteCode: [{ value: '06752000' }],
              geoLocation: {
                geogLocation: { latitude: 40.665, longitude: -105.223 },
              },
            },
            variable: { variableCode: [{ value: '00060' }] },
            values: [{ value: [{ value: '312', dateTime: '2026-07-20T13:00:00-06:00' }] }],
          },
          {
            sourceInfo: {
              siteName: 'CACHE LA POUDRE RIV AT CANYON MOUTH NR FT COLLINS',
              siteCode: [{ value: '06752000' }],
              geoLocation: {
                geogLocation: { latitude: 40.665, longitude: -105.223 },
              },
            },
            variable: { variableCode: [{ value: '00065' }] },
            values: [{ value: [{ value: '1.8', dateTime: '2026-07-20T13:00:00-06:00' }] }],
          },
          {
            sourceInfo: {
              siteName: 'CACHE LA POUDRE RIV AT CANYON MOUTH NR FT COLLINS',
              siteCode: [{ value: '06752000' }],
              geoLocation: {
                geogLocation: { latitude: 40.665, longitude: -105.223 },
              },
            },
            variable: { variableCode: [{ value: '00010' }] },
            values: [{ value: [{ value: '14.2', dateTime: '2026-07-20T13:00:00-06:00' }] }],
          },
        ],
      },
    };

    const gauges = parseNwisIv(data);
    assert.equal(gauges.size, 1);
    const g = gauges.get('06752000');
    assert.equal(g.discharge_cfs, 312);
    assert.equal(g.gauge_height_ft, 1.8);
    assert.equal(g.water_temp_f, 58);
    assert.equal(g.observed, '2026-07-20T13:00:00-06:00');
  });

  it('assigns nearest gauge within 30 km', () => {
    const gauges = parseNwisIv({
      value: {
        timeSeries: [
          {
            sourceInfo: {
              siteName: 'NEAR',
              siteCode: [{ value: '1' }],
              geoLocation: { geogLocation: { latitude: 40.0, longitude: -105.0 } },
            },
            variable: { variableCode: [{ value: '00060' }] },
            values: [{ value: [{ value: '10', dateTime: '2026-07-20T12:00:00Z' }] }],
          },
          {
            sourceInfo: {
              siteName: 'FAR',
              siteCode: [{ value: '2' }],
              geoLocation: { geogLocation: { latitude: 39.0, longitude: -108.0 } },
            },
            variable: { variableCode: [{ value: '00060' }] },
            values: [{ value: [{ value: '99', dateTime: '2026-07-20T12:00:00Z' }] }],
          },
        ],
      },
    });

    const bySlug = assignNearestGauges(
      [{ slug: 'boulder', name: 'Boulder', lat: 40.01, lon: -105.01, elevation_ft: 5300 }],
      gauges,
    );
    assert.equal(bySlug.size, 1);
    const row = bySlug.get('boulder');
    assert.equal(row.station_id, '1');
    assert.equal(row.discharge_cfs, 10);
    assert.ok(row.distance_km < 5);
    assert.match(row.url, /site_no=1/);
  });

  it('skips gauges beyond 30 km', () => {
    const gauges = parseNwisIv({
      value: {
        timeSeries: [
          {
            sourceInfo: {
              siteName: 'FAR',
              siteCode: [{ value: '2' }],
              geoLocation: { geogLocation: { latitude: 37.0, longitude: -108.5 } },
            },
            variable: { variableCode: [{ value: '00060' }] },
            values: [{ value: [{ value: '1', dateTime: '2026-07-20T12:00:00Z' }] }],
          },
        ],
      },
    });
    const bySlug = assignNearestGauges(
      [{ slug: 'denver', name: 'Denver', lat: 39.74, lon: -104.99, elevation_ft: 5280 }],
      gauges,
    );
    assert.equal(bySlug.size, 0);
  });
});

describe('fetchUsgs with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('assigns nearest gauge from the USGS IV fixture', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => usgsFixture,
      });

    const result = await fetchUsgs([
      {
        slug: 'fort-collins',
        name: 'Fort Collins',
        lat: 40.665,
        lon: -105.223,
        region: 'front-range',
        county: 'Larimer',
        wfo: 'BOU',
        elevation_ft: 5000,
      },
    ]);
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 1);
    assert.equal(result.bySlug.get('fort-collins')?.station_id, '06752000');
  });

  it('returns error when fetch fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'err',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchUsgs([
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
    assert.ok(result.error);
  });
});
