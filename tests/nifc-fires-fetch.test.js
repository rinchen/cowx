import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchNifcFires } from '../scripts/fetch/adapters/nifc-fires.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nifcFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/nifc-fires.geojson'), 'utf8'),
);

describe('fetchNifcFires with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('returns ok with nearby incidents', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => nifcFixture,
      });

    const result = await fetchNifcFires([
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
    assert.equal(result.calls, 1);
    assert.ok(Array.isArray(result.bySlug.get('denver')?.incidents));
    assert.ok(result.bySlug.get('denver').incidents.length > 0);
  });

  it('returns error when the query fails', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 503,
        text: async () => 'down',
        json: async () => {
          throw new Error('no json');
        },
      });

    const result = await fetchNifcFires([
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
    assert.equal(result.bySlug.get('denver'), null);
    assert.ok(result.error);
  });
});
