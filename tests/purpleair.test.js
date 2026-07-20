import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchPurpleAir, pm25ToAqi } from '../scripts/fetch/adapters/purpleair.js';

describe('pm25ToAqi', () => {
  it('maps known EPA breakpoints', () => {
    assert.equal(pm25ToAqi(0), 0);
    assert.equal(pm25ToAqi(12), 50);
    assert.equal(pm25ToAqi(35.4), 100);
    assert.equal(pm25ToAqi(55.4), 150);
    assert.equal(pm25ToAqi(150.4), 200);
  });

  it('returns null for invalid input and caps extreme values', () => {
    assert.equal(pm25ToAqi(null), null);
    assert.equal(pm25ToAqi(Number.NaN), null);
    assert.equal(pm25ToAqi(600), 500);
  });
});

describe('fetchPurpleAir', () => {
  it('skips when API key is missing', async () => {
    const result = await fetchPurpleAir([{ slug: 'denver', lat: 39.74, lon: -104.99 }], {});
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /PURPLEAIR_API_KEY/);
  });
});
