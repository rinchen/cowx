import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateLocationsData } from '../scripts/validate-locations.js';

const valid = {
  slug: 'denver',
  name: 'Denver',
  lat: 39.74,
  lon: -104.99,
  region: 'Front Range',
  county: 'Denver',
  wfo: 'BOU',
  elevation_ft: 5280,
};

describe('validateLocationsData', () => {
  it('accepts a valid catalog entry', () => {
    assert.deepEqual(validateLocationsData([valid]), []);
  });

  it('rejects empty array', () => {
    assert.match(validateLocationsData([])[0], /at least one/);
  });

  it('rejects missing fields', () => {
    const errors = validateLocationsData([{ slug: 'x' }]);
    assert.ok(errors.some((e) => e.includes('missing required field')));
  });

  it('rejects duplicate slugs', () => {
    const errors = validateLocationsData([valid, { ...valid }]);
    assert.ok(errors.some((e) => e.includes('duplicate slug')));
  });

  it('rejects out-of-state coordinates', () => {
    const errors = validateLocationsData([{ ...valid, lat: 40.7, lon: -74.0 }]);
    assert.ok(errors.some((e) => e.includes('outside Colorado')));
  });

  it('rejects bad slug format', () => {
    const errors = validateLocationsData([{ ...valid, slug: 'Denver CO' }]);
    assert.ok(errors.some((e) => e.includes('kebab-case')));
  });
});
