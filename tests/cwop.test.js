import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  assignPwsFromStations,
  fetchCwop,
  parseNearbyStations,
} from '../scripts/fetch/adapters/cwop.js';

const denverLoc = {
  slug: 'denver',
  name: 'Denver',
  lat: 39.74,
  lon: -104.99,
  region: 'front-range',
  county: 'Denver',
  wfo: 'BOU',
  elevation_ft: 5280,
  pws_id: 'KCODENVE123',
};

describe('parseNearbyStations', () => {
  it('keeps in-state stations and coerces weather fields', () => {
    const stations = parseNearbyStations([
      {
        callsign: 'DW1234',
        position: { lat: 39.74, lon: -104.99 },
        last_report: '2026-07-24T12:00:00Z',
        weather: {
          temperature: '72.5',
          humidity: 40,
          pressure: '1012.3',
          wind_speed: 5,
          wind_gust: 12,
          wind_direction: 270,
        },
      },
    ]);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].callsign, 'DW1234');
    assert.equal(stations[0].temp_f, 72.5);
    assert.equal(stations[0].humidity, 40);
    assert.equal(stations[0].pressure_mb, 1012.3);
    assert.equal(stations[0].wind_speed_mph, 5);
    assert.equal(stations[0].wind_gust_mph, 12);
    assert.equal(stations[0].wind_dir_deg, 270);
    assert.equal(stations[0].observed, '2026-07-24T12:00:00Z');
  });

  it('drops out-of-state, malformed, and callsign-less rows', () => {
    const stations = parseNearbyStations({
      data: [
        { callsign: 'WY1', lat: 41.5, lon: -104.8 }, // Wyoming
        { callsign: 'BAD', lat: 'x', lon: -104.99 },
        { lat: 39.74, lon: -104.99 }, // no callsign
        null,
        { base_callsign: 'CW9999', lat: 40.0, lon: -105.2, weather: {} },
      ],
    });
    assert.equal(stations.length, 1);
    assert.equal(stations[0].callsign, 'CW9999');
    assert.equal(stations[0].temp_f, null);
  });
});

describe('assignPwsFromStations', () => {
  const near = {
    callsign: 'NEAR1',
    lat: 39.75,
    lon: -104.98,
    temp_f: 70,
    humidity: 30,
    pressure_mb: 1010,
    wind_speed_mph: 3,
    wind_gust_mph: null,
    wind_dir_deg: 180,
    observed: null,
  };
  const mid = {
    callsign: 'MID2',
    lat: 39.8,
    lon: -105.0,
    temp_f: 68,
    humidity: null,
    pressure_mb: null,
    wind_speed_mph: null,
    wind_gust_mph: null,
    wind_dir_deg: null,
    observed: null,
  };
  const far = {
    callsign: 'FAR3',
    lat: 40.5,
    lon: -104.0,
    temp_f: 60,
    humidity: null,
    pressure_mb: null,
    wind_speed_mph: null,
    wind_gust_mph: null,
    wind_dir_deg: null,
    observed: null,
  };

  it('returns nearest stations within 60 km (max 2) with links', () => {
    const pws = assignPwsFromStations(denverLoc, [far, mid, near], {
      wunderground: 'https://www.wunderground.com/dashboard/pws/KCODENVE123',
    });
    assert.ok(pws);
    assert.equal(pws.primary.callsign, 'NEAR1');
    assert.equal(pws.nearby.length, 1);
    assert.equal(pws.nearby[0].callsign, 'MID2');
    assert.match(pws.links.aprs, /aprs\.fi/);
    assert.match(pws.links.wunderground, /KCODENVE123/);
  });

  it('returns null when all stations exceed the distance cap', () => {
    const pws = assignPwsFromStations(denverLoc, [far]);
    assert.equal(pws, null);
  });
});

describe('fetchCwop with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  const tinyGrid = [{ lat: 39.74, lon: -104.99 }];
  const noSleep = async () => {};

  it('assigns bySlug / pwsBySlug and geojson on success', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          {
            callsign: 'DW1234',
            lat: 39.74,
            lon: -104.99,
            weather: { temperature: 71, humidity: 35 },
            last_report: '2026-07-24T15:00:00Z',
          },
        ],
      });

    const result = await fetchCwop([denverLoc], {
      sleepFn: noSleep,
      samplePoints: tinyGrid,
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 1);
    assert.equal(result.geojson.features.length, 1);
    const row = result.bySlug.get('denver');
    assert.equal(row?.callsign, 'DW1234');
    assert.equal(row?.temp_f, 71);
    const pws = result.pwsBySlug.get('denver');
    assert.equal(pws?.primary?.callsign, 'DW1234');
    assert.match(String(pws?.links?.wunderground), /KCODENVE123/);
  });

  it('returns partial when some grid cells fail but stations remain', async () => {
    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      if (n === 1) {
        return /** @type {Response} */ ({
          ok: false,
          status: 503,
          text: async () => 'busy',
          json: async () => {
            throw new Error('no json');
          },
        });
      }
      return /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          {
            callsign: 'CW1',
            lat: 39.74,
            lon: -104.99,
            weather: { temperature: 70 },
          },
        ],
      });
    };

    const result = await fetchCwop([denverLoc], {
      sleepFn: noSleep,
      samplePoints: [
        { lat: 39.74, lon: -104.99 },
        { lat: 40.0, lon: -105.0 },
      ],
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.calls, 2);
    assert.ok(result.error);
    assert.equal(result.bySlug.get('denver')?.callsign, 'CW1');
  });

  it('returns skipped when every grid cell fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'err',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchCwop([denverLoc], {
      sleepFn: noSleep,
      samplePoints: tinyGrid,
    });
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.get('denver'), null);
    assert.equal(result.geojson.features.length, 0);
    assert.ok(result.error);
  });
});
