import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeCountyKey,
  parseCoemRestrictionHtml,
  buildRestrictionForLocation,
  fetchBurnRestrictions,
} from '../scripts/fetch/adapters/burn-restrictions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linksPath = path.join(__dirname, '../scripts/locations/co-fire-restriction-links.json');

describe('burn restrictions helpers', () => {
  it('normalizes county keys', () => {
    assert.equal(normalizeCountyKey('Adams County'), 'adams');
    assert.equal(normalizeCountyKey('Clear Creek'), 'clear creek');
    assert.equal(normalizeCountyKey('BOULDER COUNTY & CITY'), 'boulder');
  });

  it('parses COEM HTML into county status map', async () => {
    const html = await readFile(path.join(__dirname, 'fixtures/coem-fire-bans.html'), 'utf8');
    const map = parseCoemRestrictionHtml(html);
    assert.equal(map.get('adams'), 'restriction_reported');
    assert.equal(map.get('bent'), 'none_reported');
    assert.equal(map.get('boulder'), 'restriction_reported');
    assert.equal(map.get('phillips'), 'none_reported');
    assert.equal(map.get('hinsdale'), 'restriction_reported');
  });

  it('builds unknown status with county link when not in map', () => {
    const payload = buildRestrictionForLocation(
      {
        slug: 'denver',
        county: 'Denver',
        lat: 39.7,
        lon: -105,
        name: 'Denver',
        region: 'x',
        wfo: 'BOU',
        elevation_ft: 5000,
      },
      new Map(),
      {
        counties: { Denver: 'https://example.com/denver' },
        statewide: [{ name: 'DFPC', url: 'https://example.com/dfpc' }],
      },
      null,
    );
    assert.equal(payload.status, 'unknown');
    assert.equal(payload.countyUrl, 'https://example.com/denver');
    assert.equal(payload.statewideUrls.length, 1);
    assert.match(payload.disclaimer, /Verify/i);
  });

  it('fetchBurnRestrictions uses fixture HTML and curated links', async () => {
    const html = await readFile(path.join(__dirname, 'fixtures/coem-fire-bans.html'), 'utf8');
    const result = await fetchBurnRestrictions(
      [
        {
          slug: 'brighton',
          name: 'Brighton',
          lat: 39.9,
          lon: -104.8,
          region: 'Front Range',
          county: 'Adams',
          wfo: 'BOU',
          elevation_ft: 5000,
        },
        {
          slug: 'las-animas',
          name: 'Las Animas',
          lat: 38.0,
          lon: -103.2,
          region: 'Plains',
          county: 'Bent',
          wfo: 'PUB',
          elevation_ft: 4000,
        },
      ],
      { fetchHtml: async () => html, linksPath },
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.get('brighton')?.status, 'restriction_reported');
    assert.equal(result.bySlug.get('las-animas')?.status, 'none_reported');
    assert.ok(result.bySlug.get('brighton')?.countyUrl);
    assert.ok(result.bySlug.get('brighton')?.statewideUrls?.length >= 1);
  });
});
