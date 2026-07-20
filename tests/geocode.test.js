import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
});
