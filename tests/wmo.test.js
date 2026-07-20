import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wmoLabel } from '../scripts/fetch/adapters/openmeteo.js';

describe('wmoLabel', () => {
  it('maps clear and thunderstorms', () => {
    assert.equal(wmoLabel(0), 'Clear');
    assert.equal(wmoLabel(95), 'Thunderstorm');
  });

  it('falls back for unknown codes', () => {
    assert.match(wmoLabel(1234), /Code 1234/);
  });
});
