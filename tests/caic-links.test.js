import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaicLink,
  isCaicRelevantRegion,
  CAIC_FORECASTS_URL,
} from '../scripts/lib/caic-links.js';

describe('CAIC offsite links', () => {
  it('marks mountain regions as relevant', () => {
    assert.equal(isCaicRelevantRegion('mountains'), true);
    assert.equal(isCaicRelevantRegion('northwest'), true);
    assert.equal(isCaicRelevantRegion('southwest'), true);
    assert.equal(isCaicRelevantRegion('front-range'), false);
    assert.equal(isCaicRelevantRegion('eastern-plains'), false);
  });

  it('builds https forecast hub link for mountain locations', () => {
    const link = buildCaicLink({ region: 'mountains', name: 'Aspen' });
    assert.ok(link);
    assert.equal(link.url, CAIC_FORECASTS_URL);
    assert.match(link.url, /^https:\/\//);
    assert.match(link.note, /does not scrape/i);
  });

  it('returns null for non-mountain regions', () => {
    assert.equal(buildCaicLink({ region: 'front-range', name: 'Denver' }), null);
    assert.equal(buildCaicLink(null), null);
  });
});
