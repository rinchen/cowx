import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageMinutesFromIso,
  cacheBustLiveMetaUrl,
  liveMetaRecovered,
  parseGeneratedAt,
  updateWeatherMitigationActive,
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

describe('cacheBustLiveMetaUrl', () => {
  it('appends cowx_cb on a path-only URL', () => {
    assert.equal(
      cacheBustLiveMetaUrl('https://rinchen.github.io/cowx/data/meta.json', 1757791769000),
      'https://rinchen.github.io/cowx/data/meta.json?cowx_cb=1757791769000',
    );
  });

  it('replaces an existing cowx_cb query param', () => {
    assert.equal(
      cacheBustLiveMetaUrl('https://rinchen.github.io/cowx/data/meta.json?cowx_cb=1', 99),
      'https://rinchen.github.io/cowx/data/meta.json?cowx_cb=99',
    );
  });
});

describe('updateWeatherMitigationActive', () => {
  const now = Date.parse('2026-09-13T19:29:29Z');

  it('is active while a run is in progress or queued', () => {
    assert.equal(updateWeatherMitigationActive({ inProgressCount: 1, nowMs: now }), true);
    assert.equal(updateWeatherMitigationActive({ queuedCount: 1, nowMs: now }), true);
  });

  it('is active when a successful run finished inside the grace window', () => {
    assert.equal(
      updateWeatherMitigationActive({
        latestSuccessCompletedAt: '2026-09-13T19:29:15Z',
        nowMs: now,
        recentSuccessGraceMinutes: 10,
      }),
      true,
    );
  });

  it('is inactive when the last success is older than the grace window', () => {
    assert.equal(
      updateWeatherMitigationActive({
        latestSuccessCompletedAt: '2026-09-13T19:00:00Z',
        nowMs: now,
        recentSuccessGraceMinutes: 10,
      }),
      false,
    );
  });

  it('ignores recent success when grace is 0 (pre-dispatch)', () => {
    assert.equal(
      updateWeatherMitigationActive({
        latestSuccessCompletedAt: '2026-09-13T19:29:15Z',
        nowMs: now,
        recentSuccessGraceMinutes: 0,
      }),
      false,
    );
  });
});
