import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  criticalSourcesOk,
  locationPayloadPath,
  sanitizeWebcamLinks,
} from '../scripts/fetch/index.js';

describe('criticalSourcesOk', () => {
  it('requires Open-Meteo ok or partial', () => {
    assert.equal(criticalSourcesOk({ status: 'ok' }), true);
    assert.equal(criticalSourcesOk({ status: 'partial' }), true);
    assert.equal(criticalSourcesOk({ status: 'error' }), false);
    assert.equal(criticalSourcesOk({ status: 'skipped' }), false);
    assert.equal(criticalSourcesOk({}), false);
  });

  it('does not treat stale carry-forward alone as success', () => {
    // staleCount > 0 previously kept the job green even when Open-Meteo failed.
    assert.equal(criticalSourcesOk({ status: 'error' }), false);
  });
});

describe('locationPayloadPath', () => {
  it('resolves a valid slug under public/data/locations', () => {
    const p = locationPayloadPath('fort-collins');
    assert.equal(path.basename(p), 'fort-collins.json');
    assert.match(p, /[/\\]public[/\\]data[/\\]locations[/\\]fort-collins\.json$/);
  });

  it('rejects path tricks, empty, and uppercase slugs', () => {
    for (const bad of ['../etc/passwd', 'foo/bar', '', 'Denver', 'UPPER']) {
      assert.throws(() => locationPayloadPath(bad), /invalid location slug/);
    }
  });
});

describe('sanitizeWebcamLinks', () => {
  it('keeps https webcam entries and drops unsafe schemes', () => {
    const out = sanitizeWebcamLinks([
      { name: 'City cam', url: 'https://example.com/cam', kind: 'city' },
      { name: 'Bad', url: 'javascript:alert(1)' },
      { name: 'Http only', url: 'http://example.com/cam' },
      { name: '', url: 'https://example.com/x' },
      null,
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'City cam');
    assert.equal(out[0].kind, 'city');
  });

  it('returns empty for non-arrays', () => {
    assert.deepEqual(sanitizeWebcamLinks(null), []);
    assert.deepEqual(sanitizeWebcamLinks({}), []);
  });
});
