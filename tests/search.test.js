import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getFavoriteLocations, searchLocations } from '../public/js/search.js';

const locations = [
  { slug: 'denver', name: 'Denver', lat: 39.7392, lon: -104.9903, county: 'Denver' },
  { slug: 'boulder', name: 'Boulder', lat: 40.015, lon: -105.2705, county: 'Boulder' },
  {
    slug: 'colorado-springs',
    name: 'Colorado Springs',
    lat: 38.8339,
    lon: -104.8214,
    county: 'El Paso',
  },
  { slug: 'sedalia', name: 'Sedalia', lat: 39.4369, lon: -104.9636, county: 'Douglas' },
  {
    slug: 'sedalia-south',
    name: 'Sedalia South',
    lat: 39.4,
    lon: -104.95,
    county: 'Douglas',
  },
  { slug: 'perry-park', name: 'Perry Park', lat: 39.25, lon: -104.9833, county: 'Douglas' },
];

describe('searchLocations', () => {
  it('matches name, county, and slug', () => {
    assert.equal(searchLocations(locations, [], 'boulder')[0].slug, 'boulder');
    assert.equal(searchLocations(locations, [], 'el paso')[0].slug, 'colorado-springs');
    assert.equal(searchLocations(locations, [], 'colorado-springs')[0].slug, 'colorado-springs');
  });

  it('resolves ZIP to nearest catalog point', () => {
    const zips = [{ zip: '80302', lat: 40.015, lon: -105.27, city: 'Boulder', county: 'Boulder' }];
    const hits = searchLocations(locations, zips, '80302');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].slug, 'boulder');
  });

  it('resolves 80135 Sedalia ZIP to nearest Douglas County catalog point', () => {
    const zips = [
      { zip: '80135', lat: 39.3113, lon: -105.0676, city: 'Sedalia', county: 'Douglas' },
    ];
    const hits = searchLocations(locations, zips, '80135');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].slug, 'perry-park');
  });

  it('returns empty for blank or unknown ZIP', () => {
    assert.deepEqual(searchLocations(locations, [], ''), []);
    assert.deepEqual(searchLocations(locations, [], '00000'), []);
  });
});

describe('getFavoriteLocations', () => {
  it('preserves favorite order and drops missing slugs', () => {
    const favs = getFavoriteLocations(locations, ['boulder', 'missing', 'denver']);
    assert.deepEqual(
      favs.map((l) => l.slug),
      ['boulder', 'denver'],
    );
  });
});
