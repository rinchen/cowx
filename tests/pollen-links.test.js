import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollenHealthLinks,
  nearestPollenLink,
  pollenComUrlForZip,
} from '../scripts/lib/pollen-links.js';

describe('pollen-links', () => {
  const zips = [
    { zip: '80202', lat: 39.7527, lon: -104.9997, city: 'Denver' },
    { zip: '81501', lat: 39.067, lon: -108.565, city: 'Grand Junction' },
    { zip: '80501', lat: 40.167, lon: -105.101, city: 'Longmont' },
  ];

  it('builds pollen.com URL from ZIP', () => {
    assert.equal(
      pollenComUrlForZip('80501'),
      'https://www.pollen.com/forecast/current/pollen/80501',
    );
  });

  it('picks nearest ZIP for Front Range and Western Slope points', () => {
    const denver = nearestPollenLink({ lat: 39.74, lon: -104.99 }, zips);
    assert.equal(denver?.zip, '80202');
    assert.match(denver?.url ?? '', /\/80202$/);

    const gj = nearestPollenLink({ lat: 39.06, lon: -108.55 }, zips);
    assert.equal(gj?.zip, '81501');
  });

  it('buildPollenHealthLinks includes statewide NAB links', () => {
    const links = buildPollenHealthLinks({ lat: 38.83, lon: -104.82 }, zips);
    assert.ok(links.pollen?.startsWith('https://www.pollen.com/'));
    assert.ok(links.pollen_zip);
    assert.equal(links.nab_links.length, 2);
    for (const nab of links.nab_links) {
      assert.ok(nab.url.startsWith('https://'));
      assert.ok(nab.name.length > 0);
    }
  });
});
