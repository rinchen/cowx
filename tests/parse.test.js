import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toFiniteNumber } from '../scripts/lib/parse.js';

describe('toFiniteNumber', () => {
  it('parses numeric strings and numbers', () => {
    assert.equal(toFiniteNumber(42), 42);
    assert.equal(toFiniteNumber('3.5'), 3.5);
    assert.equal(toFiniteNumber(0), 0);
    assert.equal(toFiniteNumber('0'), 0);
  });

  it('returns null for empty, nullish, or non-finite values', () => {
    assert.equal(toFiniteNumber(null), null);
    assert.equal(toFiniteNumber(undefined), null);
    assert.equal(toFiniteNumber(''), null);
    assert.equal(toFiniteNumber('abc'), null);
    assert.equal(toFiniteNumber(Number.NaN), null);
    assert.equal(toFiniteNumber(Infinity), null);
  });
});
