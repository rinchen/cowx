import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateLocationsData } from '../scripts/validate-locations.js';

const valid = {
  slug: 'denver',
  name: 'Denver',
  lat: 39.74,
  lon: -104.99,
  region: 'front-range',
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

  it('rejects region outside the schema enum', () => {
    const errors = validateLocationsData([{ ...valid, region: 'Front Range' }]);
    assert.ok(errors.some((e) => e.includes('region must be one of')));
  });

  it('rejects wfo outside BOU/PUB/GJT', () => {
    const errors = validateLocationsData([{ ...valid, wfo: 'GLD' }]);
    assert.ok(errors.some((e) => e.includes('wfo must be one of')));
  });

  it('rejects whitespace-only name and county', () => {
    const nameErrs = validateLocationsData([{ ...valid, name: '   ' }]);
    assert.ok(nameErrs.some((e) => e.includes('name must be a non-empty string')));
    const countyErrs = validateLocationsData([{ ...valid, county: '\t' }]);
    assert.ok(countyErrs.some((e) => e.includes('county must be a non-empty string')));
  });

  it('rejects NaN and negative elevation_ft', () => {
    const nanErrs = validateLocationsData([{ ...valid, elevation_ft: Number.NaN }]);
    assert.ok(nanErrs.some((e) => e.includes('finite number')));
    const negErrs = validateLocationsData([{ ...valid, elevation_ft: -100 }]);
    assert.ok(negErrs.some((e) => e.includes('must be >= 0')));
  });
});
