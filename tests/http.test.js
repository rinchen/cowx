import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAdapterSafely } from '../scripts/lib/adapter-runner.js';
import { sanitizeErrorMessage, sanitizeUrlForError } from '../scripts/lib/http.js';

describe('sanitizeUrlForError', () => {
  it('redacts API_KEY query params', () => {
    const url =
      'https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&API_KEY=super-secret';
    const safe = sanitizeUrlForError(url);
    assert.match(safe, /API_KEY=%5Bredacted%5D|API_KEY=\[redacted\]/);
    assert.doesNotMatch(safe, /super-secret/);
  });

  it('redacts api_key in malformed URL strings', () => {
    const safe = sanitizeErrorMessage(
      'HTTP 401 for https://example.com?api_key=abc123&x=1: unauthorized',
    );
    assert.doesNotMatch(safe, /abc123/);
    assert.match(safe, /api_key=\[redacted\]/i);
  });
});

describe('runAdapterSafely', () => {
  it('returns adapter result on success', async () => {
    const bySlug = new Map([['denver', { ok: true }]]);
    const result = await runAdapterSafely(async () => ({
      status: 'ok',
      bySlug,
      calls: 2,
    }));
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    assert.equal(result.calls, 2);
  });

  it('catches throws and returns error status without leaking secrets', async () => {
    const result = await runAdapterSafely(async () => {
      throw new Error('HTTP 403 for https://api.example/?API_KEY=leak-me: forbidden');
    });
    assert.equal(result.status, 'error');
    assert.equal(result.bySlug.size, 0);
    assert.doesNotMatch(String(result.error), /leak-me/);
    assert.match(String(result.error), /API_KEY=\[redacted\]/i);
  });
});
