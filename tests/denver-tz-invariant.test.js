/**
 * Host-timezone invariant suite for Open-Meteo America/Denver local ISO times.
 *
 * Open-Meteo returns offset-less strings like `2026-07-22T12:00` meaning noon
 * Mountain time — NOT the runner/browser local zone. Parsing them with
 * `new Date(t)` breaks on CI (UTC) and for visitors outside Colorado.
 *
 * `pnpm test` forces `TZ=UTC` so these traps fail in CI even when developers
 * run under America/Denver. Do not weaken assertions to “whatever Date says”.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeBottomLine } from '../public/js/bottom-line.js';
import {
  dailyIndexForNow,
  denverDateKey,
  denverHourKey,
  nearestHourIndex,
  precipTodayInches,
} from '../public/js/denver-time.js';
import { resolveCatalogNow, resolveRfComms } from '../public/js/live.js';
import { pickNowCurrent, pickNowSky, sliceCompactHours } from '../public/js/outlook.js';
import { nearestThunderstormPct } from '../scripts/fetch/adapters/openmeteo.js';

/** Classic trap: 12:16 MDT = 18:16Z — UTC hosts mis-read `T12:00` as noon UTC. */
const NOONISH_MDT = new Date('2026-07-22T18:16:00Z').getTime();
/** 06:16 MDT = 12:16Z */
const MORNING_MDT = new Date('2026-07-22T12:16:00Z').getTime();
/** Just before Denver midnight: 23:30 MDT Jul 21 = 05:30Z Jul 22 */
const BEFORE_DENVER_MIDNIGHT = new Date('2026-07-22T05:30:00Z').getTime();
/** Just after Denver midnight: 00:30 MDT Jul 22 = 06:30Z Jul 22 */
const AFTER_DENVER_MIDNIGHT = new Date('2026-07-22T06:30:00Z').getTime();

describe('denver-tz-invariant: calendar keys', () => {
  it('denverDateKey uses America/Denver across UTC midnight', () => {
    assert.equal(denverDateKey(BEFORE_DENVER_MIDNIGHT), '2026-07-21');
    assert.equal(denverDateKey(AFTER_DENVER_MIDNIGHT), '2026-07-22');
    assert.equal(denverDateKey(NOONISH_MDT), '2026-07-22');
  });

  it('denverHourKey matches Mountain wall clock, not UTC hour', () => {
    // 18:16Z → 12 MDT
    assert.equal(denverHourKey(NOONISH_MDT), '2026-07-22T12');
    // 12:16Z → 06 MDT
    assert.equal(denverHourKey(MORNING_MDT), '2026-07-22T06');
    // 05:30Z → 23 MDT previous calendar day
    assert.equal(denverHourKey(BEFORE_DENVER_MIDNIGHT), '2026-07-21T23');
  });
});

describe('denver-tz-invariant: nearestHourIndex', () => {
  it('picks Denver-local noon over 18:00 when now is 12:16 MDT (CI UTC trap)', () => {
    const times = ['2026-07-22T06:00', '2026-07-22T12:00', '2026-07-22T18:00', '2026-07-23T00:00'];
    // Host-local Date parsing under TZ=UTC would pick index 2 (18:00).
    assert.equal(nearestHourIndex(times, NOONISH_MDT), 1);
  });

  it('picks morning hour at 06:16 MDT, not evening leftovers', () => {
    const times = ['2026-07-21T19:00', '2026-07-22T06:00', '2026-07-22T07:00'];
    assert.equal(nearestHourIndex(times, MORNING_MDT), 1);
  });

  it('still resolves absolute Z timestamps by instant', () => {
    const now = new Date('2026-07-20T15:10:00Z').getTime();
    const times = [
      '2026-07-20T13:00:00Z',
      '2026-07-20T14:00:00Z',
      '2026-07-20T15:00:00Z',
      '2026-07-20T16:00:00Z',
    ];
    assert.equal(nearestHourIndex(times, now), 2);
  });

  it('returns 0 for empty series', () => {
    assert.equal(nearestHourIndex([]), 0);
    assert.equal(nearestHourIndex(/** @type {string[]} */ ([])), 0);
  });
});

describe('denver-tz-invariant: precipTodayInches', () => {
  it('sums only Denver calendar-day hours through current Mountain hour', () => {
    const times = [
      '2026-07-21T22:00',
      '2026-07-22T06:00',
      '2026-07-22T07:00',
      '2026-07-22T12:00',
      '2026-07-22T18:00',
    ];
    const precip = [0.9, 0.1, 0.05, 0.2, 0.3];
    // 12:16 MDT → include ≤ 12, exclude yesterday + 18:00
    assert.equal(precipTodayInches(times, precip, NOONISH_MDT), 0.35);
  });

  it('resets at Denver midnight (UTC still Jul 22)', () => {
    const times = ['2026-07-21T22:00', '2026-07-22T00:00', '2026-07-22T01:00'];
    const precip = [0.5, 0.1, 0.05];
    assert.equal(precipTodayInches(times, precip, BEFORE_DENVER_MIDNIGHT), 0.5);
    // 00:30 MDT → hour key T00; T01 is still in the future for “through current hour”
    assert.equal(precipTodayInches(times, precip, AFTER_DENVER_MIDNIGHT), 0.1);
  });
});

describe('denver-tz-invariant: dailyIndexForNow', () => {
  it('selects Denver today when daily[0] is yesterday', () => {
    const daily = { time: ['2026-07-21', '2026-07-22', '2026-07-23'] };
    assert.equal(dailyIndexForNow(daily, BEFORE_DENVER_MIDNIGHT), 0);
    assert.equal(dailyIndexForNow(daily, AFTER_DENVER_MIDNIGHT), 1);
    assert.equal(dailyIndexForNow(daily, NOONISH_MDT), 1);
  });
});

describe('denver-tz-invariant: resolveCatalogNow / pickNow*', () => {
  const hourly = {
    time: [
      '2026-07-21T20:00',
      '2026-07-22T06:00',
      '2026-07-22T07:00',
      '2026-07-22T12:00',
      '2026-07-22T18:00',
    ],
    temperature_2m: [90, 67, 70, 85, 88],
    precipitation: [0.4, 0.1, 0.05, 0.2, 0.3],
    weather_code: [0, 3, 3, 61, 0],
    is_day: [1, 1, 1, 1, 1],
    apparent_temperature: [88, 68, 71, 84, 86],
    relative_humidity_2m: [20, 55, 50, 35, 25],
    wind_speed_10m: [14, 4, 5, 8, 12],
    wind_direction_10m: [105, 220, 230, 180, 150],
    wind_gusts_10m: [21, 8, 9, 14, 18],
    cloud_cover: [0, 100, 90, 70, 10],
  };

  it('At a Glance now uses Denver nearest hour + precip day (CI regression)', () => {
    const snapshot = { temp_f: 90, precip_today_in: 9.99, surface_pressure_mb: 850 };
    const merged = resolveCatalogNow(snapshot, hourly, NOONISH_MDT);
    assert.ok(merged);
    // Must be 12:00 slot (85°F), not 18:00 (88°F) which UTC Date() would pick
    assert.equal(merged.temp_f, 85);
    assert.equal(merged.precip_today_in, 0.35);
    assert.equal(merged.surface_pressure_mb, 850);
    assert.equal(merged.condition, 'Slight Rain');
  });

  it('pickNowCurrent matches the same Denver hour', () => {
    const now = pickNowCurrent(hourly, NOONISH_MDT);
    assert.ok(now);
    assert.equal(now.temp_f, 85);
    assert.equal(now.time, '2026-07-22T12:00');
  });

  it('pickNowSky follows Denver nearest weather_code', () => {
    const sky = pickNowSky(hourly, NOONISH_MDT);
    assert.ok(sky);
    assert.equal(sky.weather_code, 61);
    assert.match(String(sky.condition), /rain/i);
  });

  it('sliceCompactHours starts at Denver nearest hour', () => {
    const rows = sliceCompactHours(hourly, { count: 3, nowMs: NOONISH_MDT });
    assert.equal(rows.length, 2); // only 12:00 and 18:00 remain
    assert.equal(rows[0].time, '2026-07-22T12:00');
    assert.equal(rows[0].temp_f, 85);
  });
});

describe('denver-tz-invariant: fetch + RF helpers', () => {
  it('nearestThunderstormPct uses Denver-local OM hours', () => {
    // 13:10 MDT = 19:10Z — must pick T13 (22%), not T19 if present as mis-parse
    const nowMs = new Date('2026-07-20T19:10:00Z').getTime();
    const pct = nearestThunderstormPct(
      ['2026-07-20T12:00', '2026-07-20T13:00', '2026-07-20T19:00'],
      [1, 22, 99],
      nowMs,
    );
    assert.equal(pct, 22);
  });

  it('resolveRfComms picks Denver nearest 850 mb hour', () => {
    const hourly = {
      time: ['2026-07-21T19:00', '2026-07-22T06:00', '2026-07-22T07:00'],
      temperature_850hPa: [15, 20, 20],
    };
    const cool = { temp_f: 55, wind_speed_mph: 5, wind_gust_mph: 8 };
    const rf = resolveRfComms(cool, hourly, 5000, null, MORNING_MDT);
    assert.ok(rf);
    assert.equal(rf.status, 'ducting_likely');
  });
});

describe('denver-tz-invariant: bottom line', () => {
  it('headline sky uses Denver nearest hour around wall-clock now', () => {
    const nowMs = Date.now();
    /** @param {number} hourOffset */
    const denverHour = (hourOffset) => `${denverHourKey(nowMs + hourOffset * 3600_000)}:00`;
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 4, condition: 'Clear', humidity: 35, temp_f: 72, weather_code: 0 },
      alerts: [],
      hourly: {
        time: [denverHour(-1), denverHour(0), denverHour(1)],
        weather_code: [0, 3, 3],
        is_day: [1, 1, 1],
      },
    });
    assert.equal(priority, 'nominal');
    assert.match(headline, /Overcast/);
    assert.doesNotMatch(headline, /^Clear/);
  });
});

describe('denver-tz-invariant: CI timezone guard', () => {
  it('pnpm test runs under TZ=UTC so host-local Date traps surface', () => {
    // package.json sets TZ=UTC; without it these suites can pass on Denver laptops
    // while CI (ubuntu) fails — or worse, both pass until a visitor hits EST.
    assert.equal(
      process.env.TZ,
      'UTC',
      'Expected TZ=UTC (see package.json "test" script). Re-run via `pnpm test`.',
    );
  });
});
