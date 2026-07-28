import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignNearestSnotel,
  fetchSnotel,
  filterCoSnotelStations,
  mergeSnotelData,
  precip24hFromPrec,
} from '../scripts/fetch/adapters/snotel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snotelStationsFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/snotel-stations-sample.json'), 'utf8'),
);

describe('snotel helpers', () => {
  it('filters CO SNTL stations', () => {
    const stations = filterCoSnotelStations([
      {
        stationTriplet: '1130:CO:SNTL',
        stationId: '1130',
        stateCode: 'CO',
        networkCode: 'SNTL',
        name: 'Berthoud Summit',
        latitude: 39.8,
        longitude: -105.78,
        elevation: 11300,
      },
      {
        stationTriplet: '1:WY:SNTL',
        stationId: '1',
        stateCode: 'WY',
        networkCode: 'SNTL',
        name: 'Wyoming',
        latitude: 41,
        longitude: -110,
        elevation: 9000,
      },
    ]);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].station_id, '1130');
  });

  it('computes 24h precip from cumulative PREC', () => {
    assert.equal(
      precip24hFromPrec([
        { date: '2026-07-18', value: 24.0 },
        { date: '2026-07-19', value: 24.3 },
      ]),
      0.3,
    );
    assert.equal(precip24hFromPrec([{ date: '2026-07-19', value: 24.0 }]), null);
  });

  it('merges data and assigns nearest high-elevation site', () => {
    const stations = filterCoSnotelStations([
      {
        stationTriplet: '1130:CO:SNTL',
        stationId: '1130',
        stateCode: 'CO',
        networkCode: 'SNTL',
        name: 'Berthoud Summit',
        latitude: 39.8,
        longitude: -105.78,
        elevation: 11300,
      },
    ]);
    const merged = mergeSnotelData(stations, [
      {
        stationTriplet: '1130:CO:SNTL',
        data: [
          {
            stationElement: { elementCode: 'SNWD' },
            values: [{ date: '2026-07-19', value: 12 }],
          },
          {
            stationElement: { elementCode: 'WTEQ' },
            values: [{ date: '2026-07-19', value: 4.2 }],
          },
          {
            stationElement: { elementCode: 'TOBS' },
            values: [{ date: '2026-07-19', value: 38 }],
          },
          {
            stationElement: { elementCode: 'PREC' },
            values: [
              { date: '2026-07-18', value: 10 },
              { date: '2026-07-19', value: 10 },
            ],
          },
        ],
      },
    ]);
    assert.equal(merged.get('1130:CO:SNTL').snow_depth_in, 12);
    assert.equal(merged.get('1130:CO:SNTL').swe_in, 4.2);

    const bySlug = assignNearestSnotel(
      [
        {
          slug: 'berthoud-pass',
          name: 'Berthoud Pass',
          lat: 39.8,
          lon: -105.78,
          elevation_ft: 11307,
        },
        { slug: 'denver', name: 'Denver', lat: 39.74, lon: -104.99, elevation_ft: 5280 },
      ],
      merged,
    );
    assert.equal(bySlug.size, 1);
    assert.equal(bySlug.get('berthoud-pass').station_id, '1130');
    assert.equal(bySlug.has('denver'), false);
  });

  it('loads the CO SNOTEL stations fixture', () => {
    const stations = filterCoSnotelStations(snotelStationsFixture);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].station_id, '1130');
  });
});

describe('fetchSnotel with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('returns ok when stations and readings are available', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/stations') && !url.includes('stationTriplets')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => snotelStationsFixture,
        });
      }
      return /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          {
            stationTriplet: '1130:CO:SNTL',
            data: [
              {
                stationElement: { elementCode: 'SNWD' },
                values: [{ date: '2026-07-19', value: 12 }],
              },
              {
                stationElement: { elementCode: 'WTEQ' },
                values: [{ date: '2026-07-19', value: 4.2 }],
              },
              {
                stationElement: { elementCode: 'TOBS' },
                values: [{ date: '2026-07-19', value: 38 }],
              },
              {
                stationElement: { elementCode: 'PREC' },
                values: [
                  { date: '2026-07-18', value: 10 },
                  { date: '2026-07-19', value: 10 },
                ],
              },
            ],
          },
        ],
      });
    };

    const result = await fetchSnotel([
      {
        slug: 'berthoud-pass',
        name: 'Berthoud Pass',
        lat: 39.8,
        lon: -105.78,
        region: 'mountains',
        county: 'Grand',
        wfo: 'BOU',
        elevation_ft: 11307,
      },
    ]);
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 2);
    assert.equal(result.bySlug.get('berthoud-pass')?.station_id, '1130');
  });

  it('returns error when station list fetch fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'err',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchSnotel([
      {
        slug: 'berthoud-pass',
        name: 'Berthoud Pass',
        lat: 39.8,
        lon: -105.78,
        region: 'mountains',
        county: 'Grand',
        wfo: 'BOU',
        elevation_ft: 11307,
      },
    ]);
    assert.equal(result.status, 'error');
    assert.ok(result.error);
  });
});
