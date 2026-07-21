import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  fetchCoagmet,
  mapCoagmetObs,
  parseCoagmetStations,
} from '../scripts/fetch/adapters/coagmet.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/coagmet');

describe('mapCoagmetObs', () => {
  it('maps primary field names', () => {
    const mapped = mapCoagmetObs({
      st5cm: 62,
      st15cm: 58,
      sm5cm: 0.2,
      sm15cm: 0.25,
      precip: 0.1,
      eto: 0.15,
      vaporPressure: 1.2,
      solarRad: 500,
      windSpeed: 7,
      t: 70,
      rh: 40,
    });
    assert.equal(mapped.st5, 62);
    assert.equal(mapped.st15, 58);
    assert.equal(mapped.sm5, 0.2);
    assert.equal(mapped.sm15, 0.25);
    assert.equal(mapped.precip, 0.1);
    assert.equal(mapped.eto, 0.15);
    assert.equal(mapped.vp, 1.2);
    assert.equal(mapped.sr, 500);
    assert.equal(mapped.ws, 7);
    assert.equal(mapped.tmean, 70);
    assert.equal(mapped.rh, 40);
  });

  it('accepts alternate alias field names', () => {
    const mapped = mapCoagmetObs({
      soilTemp5: 61,
      soil_temp_15: 57,
      vwc5: 0.18,
      soil_moisture_15: 0.24,
      rain: 0.02,
      et_os: 0.11,
      vapor_pressure: 0.9,
      solar: 410,
      wind: 5,
      airtemp: 68,
      humidity: 55,
    });
    assert.equal(mapped.st5, 61);
    assert.equal(mapped.st15, 57);
    assert.equal(mapped.sm5, 0.18);
    assert.equal(mapped.sm15, 0.24);
    assert.equal(mapped.precip, 0.02);
    assert.equal(mapped.eto, 0.11);
    assert.equal(mapped.vp, 0.9);
    assert.equal(mapped.sr, 410);
    assert.equal(mapped.ws, 5);
    assert.equal(mapped.tmean, 68);
    assert.equal(mapped.rh, 55);
  });
});

describe('parseCoagmetStations', () => {
  it('joins metadata and latest, skipping inactive stations', async () => {
    const meta = JSON.parse(await readFile(path.join(FIXTURES, 'metadata.json'), 'utf8'));
    const latest = JSON.parse(await readFile(path.join(FIXTURES, 'latest.json'), 'utf8'));
    const stations = parseCoagmetStations(meta, latest);
    assert.equal(stations.length, 3);
    assert.ok(stations.every((s) => s.id !== 'off01'));
    const den = stations.find((s) => s.id === 'den01');
    assert.equal(den?.st5, 65);
    assert.equal(den?.precip, 0);
  });

  it('returns empty when latest has no matching obs', async () => {
    const meta = JSON.parse(await readFile(path.join(FIXTURES, 'metadata.json'), 'utf8'));
    const latest = JSON.parse(await readFile(path.join(FIXTURES, 'empty-latest.json'), 'utf8'));
    assert.equal(parseCoagmetStations(meta, latest).length, 0);
  });
});

describe('fetchCoagmet with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  /**
   * @param {unknown} meta
   * @param {unknown} latest
   */
  function mockCoagmetFetch(meta, latest) {
    globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('metadata') ? meta : latest;
      return /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      });
    };
  }

  it('assigns nearest station within 40 km', async () => {
    const meta = JSON.parse(await readFile(path.join(FIXTURES, 'metadata.json'), 'utf8'));
    const latest = JSON.parse(await readFile(path.join(FIXTURES, 'latest.json'), 'utf8'));
    mockCoagmetFetch(meta, latest);

    const result = await fetchCoagmet([
      {
        slug: 'fort-collins',
        name: 'Fort Collins',
        lat: 40.585,
        lon: -105.084,
        region: 'front-range',
        county: 'Larimer',
        wfo: 'BOU',
        elevation_ft: 5003,
      },
      {
        slug: 'distant',
        name: 'Distant',
        lat: 37.1,
        lon: -102.2,
        region: 'eastern-plains',
        county: 'Baca',
        wfo: 'PUB',
        elevation_ft: 4000,
      },
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const row = result.bySlug.get('fort-collins');
    assert.equal(row?.station_id, 'ftc01');
    assert.ok(row?.distance_km != null && row.distance_km <= 40);
    assert.equal(row?.soil_temp_5cm_f, 62.1);
    assert.equal(result.bySlug.has('distant'), false);
  });

  it('returns error when no stations parse', async () => {
    const meta = JSON.parse(await readFile(path.join(FIXTURES, 'metadata.json'), 'utf8'));
    const latest = JSON.parse(await readFile(path.join(FIXTURES, 'empty-latest.json'), 'utf8'));
    mockCoagmetFetch(meta, latest);

    const result = await fetchCoagmet([
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
    assert.match(String(result.error), /no CoAgMET stations/);
    assert.equal(result.bySlug.size, 0);
  });
});
