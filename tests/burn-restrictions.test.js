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
  fetchCoemHtml,
  mergeFireRestrictions,
} from '../scripts/fetch/adapters/burn-restrictions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linksPath = path.join(__dirname, '../scripts/locations/co-fire-restriction-links.json');
const fixturePath = path.join(__dirname, 'fixtures/coem-fire-bans.html');

/** @returns {Promise<void>} */
const noSleep = async () => {};

/**
 * @param {number} status
 * @param {string} [body]
 * @param {Record<string, string>} [headerMap]
 */
function mockResponse(status, body = '', headerMap = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headerMap[String(name).toLowerCase()] ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}

describe('burn restrictions helpers', () => {
  it('normalizes county keys', () => {
    assert.equal(normalizeCountyKey('Adams County'), 'adams');
    assert.equal(normalizeCountyKey('Clear Creek'), 'clear creek');
    assert.equal(normalizeCountyKey('BOULDER COUNTY & CITY'), 'boulder');
  });

  it('parses COEM HTML into county status map', async () => {
    const html = await readFile(fixturePath, 'utf8');
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
    const html = await readFile(fixturePath, 'utf8');
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
    assert.equal(result.scrapeOk, true);
    assert.equal(result.bySlug.get('brighton')?.status, 'restriction_reported');
    assert.equal(result.bySlug.get('las-animas')?.status, 'none_reported');
    assert.ok(result.bySlug.get('brighton')?.countyUrl);
    assert.ok(result.bySlug.get('brighton')?.statewideUrls?.length >= 1);
  });

  it('retries COEM 429 then succeeds', async () => {
    const html = await readFile(fixturePath, 'utf8');
    let attempts = 0;
    const fetched = await fetchCoemHtml({
      sleepFn: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return mockResponse(429, 'rate limited', { 'retry-after': '1' });
        }
        return mockResponse(200, html);
      },
    });
    assert.equal(attempts, 2);
    assert.equal(fetched.calls, 2);
    assert.match(fetched.html, /ADAMS/i);

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
      ],
      {
        linksPath,
        sleepFn: noSleep,
        fetchImpl: (() => {
          let n = 0;
          return async () => {
            n += 1;
            if (n === 1) return mockResponse(429, 'rate limited');
            return mockResponse(200, html);
          };
        })(),
      },
    );
    assert.equal(result.scrapeOk, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 2);
    assert.equal(result.bySlug.get('brighton')?.status, 'restriction_reported');
  });

  it('marks scrapeOk false when all COEM attempts fail', async () => {
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
      ],
      {
        linksPath,
        sleepFn: noSleep,
        fetchImpl: async () => mockResponse(429, 'rate limited'),
      },
    );
    assert.equal(result.scrapeOk, false);
    assert.equal(result.status, 'partial');
    assert.equal(result.calls, 3);
    assert.match(String(result.error), /HTTP 429/);
    assert.equal(result.bySlug.get('brighton')?.status, 'unknown');
    assert.ok(result.bySlug.get('brighton')?.countyUrl);
  });

  it('mergeFireRestrictions carries prior status when scrape fails', () => {
    const fresh = {
      county: 'Adams',
      status: 'unknown',
      redFlagNote: true,
      countyUrl: 'https://example.com/adams-new',
      statewideUrls: [{ name: 'DFPC', url: 'https://example.com/dfpc' }],
      updatedAt: null,
      disclaimer: 'Verify',
    };
    const prior = {
      fire_restrictions: {
        county: 'Adams',
        status: 'restriction_reported',
        countyUrl: 'https://example.com/adams-old',
        updatedAt: '2026-07-25T18:53:00.000Z',
      },
    };

    const merged = mergeFireRestrictions(fresh, prior, false);
    assert.equal(merged.status, 'restriction_reported');
    assert.equal(merged.updatedAt, '2026-07-25T18:53:00.000Z');
    assert.equal(merged.countyUrl, 'https://example.com/adams-new');

    const trusted = mergeFireRestrictions(fresh, prior, true);
    assert.equal(trusted.status, 'unknown');
    assert.equal(trusted.updatedAt, null);

    const noPrior = mergeFireRestrictions(fresh, null, false);
    assert.equal(noPrior.status, 'unknown');
  });
});
