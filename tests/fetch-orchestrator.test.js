import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeWebcamLinks } from '../scripts/fetch/index.js';

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
