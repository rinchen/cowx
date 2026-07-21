import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CO_BBOX, isInColorado } from '../scripts/lib/colorado.js';

describe('CO_BBOX', () => {
  it('covers a Colorado-sized box', () => {
    assert.ok(CO_BBOX.west < CO_BBOX.east);
    assert.ok(CO_BBOX.south < CO_BBOX.north);
    assert.equal(CO_BBOX.west, -109.2);
    assert.equal(CO_BBOX.south, 36.9);
    assert.equal(CO_BBOX.east, -102.0);
    assert.equal(CO_BBOX.north, 41.1);
  });
});

describe('isInColorado', () => {
  it('accepts Denver and Grand Junction', () => {
    assert.equal(isInColorado(39.7392, -104.9903), true);
    assert.equal(isInColorado(39.0639, -108.5506), true);
  });

  it('rejects out-of-state points', () => {
    assert.equal(isInColorado(41.5, -104.8), false);
    assert.equal(isInColorado(39.0, -101.5), false);
    assert.equal(isInColorado(35.0, -105.0), false);
  });

  it('rejects non-finite coords', () => {
    assert.equal(isInColorado(NaN, -104), false);
    assert.equal(isInColorado(39, Infinity), false);
  });
});
