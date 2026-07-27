import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageMinutesFromIso,
  liveMetaRecovered,
  parseGeneratedAt,
} from '../scripts/ci/live-meta-recovery.js';

describe('parseGeneratedAt', () => {
  it('reads generatedAt', () => {
    assert.equal(
      parseGeneratedAt({ generatedAt: '2026-07-27T05:10:48.382Z' }),
      '2026-07-27T05:10:48.382Z',
    );
  });

  it('falls back to updated_at', () => {
    assert.equal(parseGeneratedAt({ updated_at: '2026-07-27T01:00:00Z' }), '2026-07-27T01:00:00Z');
  });

  it('returns empty for bad input', () => {
    assert.equal(parseGeneratedAt(null), '');
    assert.equal(parseGeneratedAt({}), '');
  });
});

describe('ageMinutesFromIso', () => {
  it('floors whole minutes', () => {
    const now = Date.parse('2026-07-27T05:04:53Z');
    assert.equal(ageMinutesFromIso('2026-07-27T02:46:38.487Z', now), 138);
  });

  it('returns null for invalid ISO', () => {
    assert.equal(ageMinutesFromIso('not-a-date'), null);
  });
});

describe('liveMetaRecovered', () => {
  it('recovers when age drops below the quiet self-heal tier', () => {
    assert.equal(
      liveMetaRecovered({
        generatedAt: '2026-07-27T05:10:48.382Z',
        ageMinutes: 1,
        baselineGeneratedAt: '2026-07-27T02:46:38.487Z',
        recoveredMaxAgeMinutes: 90,
      }),
      true,
    );
  });

  it('recovers when generatedAt advances past the notify baseline', () => {
    assert.equal(
      liveMetaRecovered({
        generatedAt: '2026-07-27T05:10:48.382Z',
        ageMinutes: 100,
        baselineGeneratedAt: '2026-07-27T02:46:38.487Z',
        recoveredMaxAgeMinutes: 90,
      }),
      true,
    );
  });

  it('stays unrecovered when still old and unchanged', () => {
    assert.equal(
      liveMetaRecovered({
        generatedAt: '2026-07-27T02:46:38.487Z',
        ageMinutes: 138,
        baselineGeneratedAt: '2026-07-27T02:46:38.487Z',
        recoveredMaxAgeMinutes: 90,
      }),
      false,
    );
  });

  it('does not treat equal timestamps as recovery', () => {
    assert.equal(
      liveMetaRecovered({
        generatedAt: '2026-07-27T02:46:38.487Z',
        ageMinutes: 120,
        baselineGeneratedAt: '2026-07-27T02:46:38.487Z',
        recoveredMaxAgeMinutes: 90,
      }),
      false,
    );
  });
});
