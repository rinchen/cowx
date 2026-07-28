import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fetchCbrfc } from '../scripts/fetch/adapters/cbrfc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cbrfcFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/cbrfc-esp-sample.json'), 'utf8'),
);

describe('fetchCbrfc with mocked fetch', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('returns ok for a location near a CBRFC CO point', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => cbrfcFixture,
      });

    const result = await fetchCbrfc([
      {
        slug: 'steamboat-springs',
        name: 'Steamboat Springs',
        lat: 40.485,
        lon: -106.831,
        region: 'northwest',
        county: 'Routt',
        wfo: 'GJT',
        elevation_ft: 6720,
      },
    ]);
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 1);
    assert.ok(result.bySlug.get('steamboat-springs'));
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

    const result = await fetchCbrfc([
      {
        slug: 'steamboat-springs',
        name: 'Steamboat Springs',
        lat: 40.485,
        lon: -106.831,
        region: 'northwest',
        county: 'Routt',
        wfo: 'GJT',
        elevation_ft: 6720,
      },
    ]);
    assert.equal(result.status, 'error');
    assert.equal(result.bySlug.get('steamboat-springs'), null);
    assert.ok(result.error);
  });
});
