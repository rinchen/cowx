import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_CO_ZIPS,
  validateCoZipsData,
  validateLocationsData,
} from '../scripts/validate-locations.js';
import { parseGeoNamesUsText } from '../scripts/locations/build-co-zips.js';

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

/** @param {number} n */
function makeZipRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    zip: String(80000 + i).padStart(5, '0'),
    lat: 39.75,
    lon: -104.99,
    city: 'Denver',
    county: 'Denver',
  }));
}

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

  it('rejects catalogs larger than 1000 locations', () => {
    const huge = Array.from({ length: 1001 }, (_, i) => ({
      ...valid,
      slug: `loc-${i}`,
      name: `Loc ${i}`,
    }));
    const errors = validateLocationsData(huge);
    assert.ok(errors.some((e) => e.includes('max 1000')));
  });
});

describe('validateCoZipsData', () => {
  it('accepts a full-sized valid ZIP table', () => {
    assert.deepEqual(validateCoZipsData(makeZipRows(MIN_CO_ZIPS)), []);
  });

  it('rejects tables below the minimum ZIP count', () => {
    const errors = validateCoZipsData(makeZipRows(10));
    assert.ok(errors.some((e) => e.includes(`at least ${MIN_CO_ZIPS}`)));
  });

  it('rejects bad zip shape and duplicates', () => {
    const rows = makeZipRows(MIN_CO_ZIPS);
    rows[0] = { zip: '8020', lat: 39.75, lon: -104.99 };
    rows[1] = { zip: '80202', lat: 39.75, lon: -104.99 };
    rows[2] = { zip: '80202', lat: 39.76, lon: -104.98 };
    const errors = validateCoZipsData(rows);
    assert.ok(errors.some((e) => e.includes('5-digit')));
    assert.ok(errors.some((e) => e.includes('duplicate')));
  });
});

describe('committed co-zips.json coverage', () => {
  it('includes 80135 Sedalia and meets minimum count', async () => {
    const zipsPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../scripts/locations/co-zips.json',
    );
    const zips = JSON.parse(await readFile(zipsPath, 'utf8'));
    assert.ok(zips.length >= MIN_CO_ZIPS);
    assert.deepEqual(validateCoZipsData(zips), []);
    const hit = zips.find((z) => z.zip === '80135');
    assert.ok(hit);
    assert.equal(hit.city, 'Sedalia');
  });
});

describe('parseGeoNamesUsText', () => {
  it('filters to Colorado and prefers higher accuracy', () => {
    const text = [
      'US\t80135\tSedalia\tColorado\tCO\tDouglas\t035\t\t\t39.3113\t-105.0676\t1',
      'US\t80135\tSedalia\tColorado\tCO\tDouglas\t035\t\t\t39.3200\t-105.0500\t4',
      'US\t80302\tBoulder\tColorado\tCO\tBoulder\t013\t\t\t40.015\t-105.27\t4',
      'US\t10001\tNew York\tNew York\tNY\tNew York\t061\t\t\t40.75\t-73.99\t4',
      'US\t99999\tNowhere\tColorado\tCO\tFake\t000\t\t\t50.0\t-104.0\t4',
    ].join('\n');
    const rows = parseGeoNamesUsText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].zip, '80135');
    assert.equal(rows[0].lat, 39.32);
    assert.equal(rows[0].city, 'Sedalia');
    assert.equal(rows[1].zip, '80302');
  });
});
