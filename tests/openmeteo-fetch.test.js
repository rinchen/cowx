import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  attachAstronomy,
  attachRfComms,
  fetchOpenMeteo,
  mapResult,
} from '../scripts/fetch/adapters/openmeteo.js';

const denver = {
  slug: 'denver',
  name: 'Denver',
  lat: 39.7392,
  lon: -104.9903,
  region: 'front-range',
  county: 'Denver',
  wfo: 'BOU',
  elevation_ft: 5280,
};

function omPayload() {
  return {
    current: {
      temperature_2m: 72,
      relative_humidity_2m: 40,
      apparent_temperature: 70,
      weather_code: 0,
      cloud_cover: 10,
      pressure_msl: 1015,
      surface_pressure: 840,
      is_day: 1,
      wind_speed_10m: 8,
      wind_direction_10m: 180,
      wind_gusts_10m: 12,
      precipitation: 0,
      uv_index: 5,
      dewpoint_2m: 45,
      visibility: 10000,
      time: '2026-07-22T12:00',
    },
    hourly: {
      time: ['2026-07-22T12:00'],
      temperature_2m: [72],
      precipitation_probability: [10],
      weather_code: [0],
      temperature_850hPa: [10],
    },
    daily: {
      time: ['2026-07-22'],
      weather_code: [0],
      temperature_2m_max: [80],
      temperature_2m_min: [55],
    },
  };
}

describe('attachRfComms / attachAstronomy', () => {
  it('attaches rf_comms and astronomy onto a mapped payload', () => {
    const mapped = mapResult(omPayload(), 'Clear');
    attachRfComms(mapped, 5280);
    attachAstronomy(mapped, denver.lat, denver.lon, new Date('2026-07-22T18:00:00Z'));
    assert.ok(mapped.rf_comms);
    assert.ok(mapped.astronomy);
    assert.ok(mapped.astronomy.sunrise || mapped.astronomy.date);
  });
});

describe('fetchOpenMeteo with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  const zeroDelays = {
    chunkDelayMs: 0,
    retryBackoffMs: 0,
    shortBackoffMs: 0,
    rateLimitDelayMs: 0,
  };

  it('maps forecast + NBM into bySlug with astronomy and rf_comms', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('nbm_conus') || url.includes('previous_day')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            hourly: {
              time: ['2026-07-22T12:00'],
              thunderstorm_probability: [15],
            },
          }),
        });
      }
      return /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => omPayload(),
      });
    };

    const result = await fetchOpenMeteo([denver], zeroDelays);
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('denver');
    assert.ok(row?.current);
    assert.ok(row?.astronomy);
    assert.ok(row?.rf_comms);
    assert.ok(result.calls >= 1);
  });

  it('returns error when every chunk fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'err',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchOpenMeteo([denver], zeroDelays);
    assert.equal(result.status, 'error');
    assert.equal(result.bySlug.size, 0);
    assert.ok(result.error);
  });
});
