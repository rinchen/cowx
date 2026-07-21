import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { isInColorado, pickColoradoNominatimResult } from '../public/js/geocode.js';

describe('isInColorado', () => {
  it('accepts Denver', () => {
    assert.equal(isInColorado(39.7392, -104.9903), true);
  });

  it('rejects Wyoming and Kansas points', () => {
    assert.equal(isInColorado(41.5, -104.8), false);
    assert.equal(isInColorado(39.0, -101.5), false);
  });

  it('rejects non-finite coords', () => {
    assert.equal(isInColorado(NaN, -104), false);
  });
});

describe('pickColoradoNominatimResult', () => {
  it('returns the first in-state hit with a label', () => {
    const hit = pickColoradoNominatimResult([
      { lat: '41.5', lon: '-104.8', display_name: 'Cheyenne, Wyoming' },
      {
        lat: '39.7392',
        lon: '-104.9903',
        display_name: '1600 Broadway, Denver, Colorado',
      },
    ]);
    assert.ok(hit);
    assert.equal(hit.lat, 39.7392);
    assert.equal(hit.lon, -104.9903);
    assert.match(hit.label, /Denver/);
  });

  it('returns null when all hits are out of state or malformed', () => {
    assert.equal(
      pickColoradoNominatimResult([{ lat: '40.7', lon: '-74.0', display_name: 'NYC' }]),
      null,
    );
    assert.equal(pickColoradoNominatimResult([]), null);
    assert.equal(pickColoradoNominatimResult(null), null);
  });

  it('truncates long display names', () => {
    const long = 'A'.repeat(300);
    const hit = pickColoradoNominatimResult([
      { lat: '39.7392', lon: '-104.9903', display_name: long },
    ]);
    assert.ok(hit);
    assert.equal(hit.label.length, 200);
  });
});

describe('geocodeColoradoAddress', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    const { resetNominatimCooldownForTests } = await import('../public/js/geocode.js');
    resetNominatimCooldownForTests();
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('returns invalid for short queries without fetching', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error('should not fetch');
    };
    const { geocodeColoradoAddress } = await import('../public/js/geocode.js');
    const result = await geocodeColoradoAddress('ab');
    assert.deepEqual(result, { ok: false, reason: 'invalid' });
    assert.equal(called, false);
  });

  it('returns empty when Nominatim has no in-state hits', async () => {
    const { geocodeColoradoAddress } = await import('../public/js/geocode.js');
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        json: async () => [{ lat: '41.5', lon: '-104.8', display_name: 'Cheyenne' }],
      });
    const result = await geocodeColoradoAddress('123 Main St Denver CO');
    assert.deepEqual(result, { ok: false, reason: 'empty' });
  });

  it('returns http on non-OK response', async () => {
    const { geocodeColoradoAddress } = await import('../public/js/geocode.js');
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 503,
        json: async () => ({}),
      });
    const result = await geocodeColoradoAddress('123 Main St Denver CO');
    assert.deepEqual(result, { ok: false, reason: 'http' });
  });

  it('enforces Nominatim cooldown between successful calls', async () => {
    const { geocodeColoradoAddress, NOMINATIM_MIN_INTERVAL_MS, resetNominatimCooldownForTests } =
      await import('../public/js/geocode.js');
    resetNominatimCooldownForTests();

    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: true,
        status: 200,
        json: async () => [
          {
            lat: '39.7392',
            lon: '-104.9903',
            display_name: '1600 Broadway, Denver, Colorado',
          },
        ],
      });

    const first = await geocodeColoradoAddress('1600 Broadway Denver CO');
    assert.equal(first.ok, true);

    const started = Date.now();
    const second = await geocodeColoradoAddress('1610 Broadway Denver CO');
    const elapsed = Date.now() - started;
    assert.equal(second.ok, true);
    assert.ok(
      elapsed >= NOMINATIM_MIN_INTERVAL_MS - 50,
      `expected ~${NOMINATIM_MIN_INTERVAL_MS}ms cooldown, got ${elapsed}ms`,
    );
  });
});
