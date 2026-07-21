import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchAirNow } from '../scripts/fetch/adapters/airnow.js';

describe('fetchAirNow', () => {
  it('skips when API key is missing', async () => {
    const result = await fetchAirNow([{ slug: 'denver', lat: 39.74, lon: -104.99 }], {});
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /AIRNOW_API_KEY/);
  });
});

describe('fetchAirNow with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('assigns nearest sample within range', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '[]',
        json: async () => [
          {
            ParameterName: 'PM2.5',
            AQI: 42,
            Category: { Name: 'Good' },
            ReportingArea: 'Denver',
            DateObserved: '2026-07-20',
            HourObserved: 12,
          },
        ],
      });

    const result = await fetchAirNow(
      [
        {
          slug: 'denver',
          lat: 39.74,
          lon: -104.99,
          name: 'Denver',
          region: 'front-range',
          county: 'Denver',
          wfo: 'BOU',
          elevation_ft: 5280,
        },
      ],
      { AIRNOW_API_KEY: 'test-key' },
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('denver');
    assert.equal(row?.aqi, 42);
    assert.equal(row?.category, 'Good');
  });
});
