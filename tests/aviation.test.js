import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchAviation } from '../scripts/fetch/adapters/aviation.js';

describe('fetchAviation', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('maps METAR to catalog ICAO and nearest station', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/metar')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '[]',
          json: async () => [
            {
              icaoId: 'KBJC',
              lat: 39.91,
              lon: -105.12,
              rawOb: 'KBJC 201753Z 27008KT 10SM FEW080 22/05 A3012',
              temp: 22,
              dewp: 5,
              wdir: 270,
              wspd: 8,
              wgst: null,
              visib: 10,
              cover: 'FEW',
              fltCat: 'VFR',
              altim: 30.12,
              obsTime: '2026-07-20T17:53:00Z',
            },
          ],
        });
      }
      if (url.includes('/taf')) {
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => '[]',
          json: async () => [
            {
              icaoId: 'KBJC',
              rawTAF: 'TAF KBJC 201720Z 2018/2118 27010KT P6SM SCT080',
            },
          ],
        });
      }
      return /** @type {Response} */ ({
        ok: false,
        status: 404,
        text: async () => 'missing',
        json: async () => ({}),
      });
    };

    const result = await fetchAviation([
      {
        slug: 'boulder',
        name: 'Boulder',
        lat: 40.02,
        lon: -105.27,
        region: 'front-range',
        county: 'Boulder',
        wfo: 'BOU',
        elevation_ft: 5430,
        icao: 'KBJC',
      },
    ]);
    assert.equal(result.status, 'ok');
    const row = result.bySlug.get('boulder');
    assert.ok(row);
    assert.equal(row.icao, 'KBJC');
    assert.equal(row.temp_f, 72);
    assert.equal(row.flight_category, 'VFR');
    assert.match(String(row.raw_taf), /TAF KBJC/);
  });

  it('returns error status when METAR request fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 503,
        text: async () => 'down',
        json: async () => ({}),
      });
    const result = await fetchAviation([
      {
        slug: 'denver',
        name: 'Denver',
        lat: 39.74,
        lon: -104.99,
        region: 'front-range',
        county: 'Denver',
        wfo: 'BOU',
        elevation_ft: 5280,
        icao: 'KDEN',
      },
    ]);
    assert.equal(result.status, 'error');
    assert.match(String(result.error), /METAR HTTP 503/);
  });
});
