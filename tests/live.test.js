import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAstronomy } from '../public/js/astronomy.js';
import { dailyIndexForNow, denverDateKey, precipTodayInches } from '../public/js/denver-time.js';
import { resolveAstronomy, resolveCatalogNow, resolveRfComms } from '../public/js/live.js';
import { buildPeriodSummaries } from '../public/js/outlook.js';

describe('denver-time', () => {
  it('formats Denver calendar date across UTC midnight', () => {
    // 2026-07-22T05:30Z = Jul 21 23:30 MDT
    assert.equal(denverDateKey(new Date('2026-07-22T05:30:00Z').getTime()), '2026-07-21');
    // 2026-07-22T06:30Z = Jul 22 00:30 MDT
    assert.equal(denverDateKey(new Date('2026-07-22T06:30:00Z').getTime()), '2026-07-22');
  });

  it('sums precip for Denver today through the current hour only', () => {
    const nowMs = new Date('2026-07-20T20:30:00Z').getTime(); // 14:30 MDT
    const sum = precipTodayInches(
      ['2026-07-20T06:00', '2026-07-20T12:00', '2026-07-20T18:00', '2026-07-21T06:00'],
      [0.1, 0.2, 0.05, 0.9],
      nowMs,
    );
    assert.equal(sum, 0.3);
  });

  it('dailyIndexForNow matches Denver calendar day, not always [0]', () => {
    const daily = {
      time: ['2026-07-21', '2026-07-22', '2026-07-23'],
      temperature_2m_max: [95, 88, 90],
      temperature_2m_min: [70, 65, 66],
    };
    // Jul 22 06:16 MDT
    const nowMs = new Date('2026-07-22T12:16:00Z').getTime();
    assert.equal(dailyIndexForNow(daily, nowMs), 1);
    assert.equal(dailyIndexForNow({ time: [] }, nowMs), -1);
    assert.equal(dailyIndexForNow(null, nowMs), -1);
  });
});

describe('resolveCatalogNow precip', () => {
  it('overwrites stale fetch-time precip_today after midnight', () => {
    const hourly = {
      time: ['2026-07-21T18:00', '2026-07-22T01:00', '2026-07-22T06:00'],
      temperature_2m: [90, 70, 67],
      precipitation: [0.5, 0.0, 0.1],
      weather_code: [0, 0, 3],
      is_day: [1, 0, 1],
    };
    const snapshot = { temp_f: 90, precip_today_in: 0.5 };
    // Jul 22 06:16 MDT — yesterday's 0.5 must not remain "rainfall today"
    const nowMs = new Date('2026-07-22T12:16:00Z').getTime();
    const merged = resolveCatalogNow(snapshot, hourly, nowMs);
    assert.ok(merged);
    assert.equal(merged.temp_f, 67);
    assert.equal(merged.precip_today_in, 0.1);
  });
});

describe('buildPeriodSummaries calendar day', () => {
  it('uses sunrise/hi/lo for Denver today when daily[0] is yesterday', () => {
    const day0Rise = '2026-07-21T13:00:00.000Z';
    const day0Set = '2026-07-22T02:00:00.000Z';
    const day1Rise = '2026-07-22T13:00:00.000Z';
    const day1Set = '2026-07-23T02:00:00.000Z';
    const day2Rise = '2026-07-23T13:00:00.000Z';

    /** @type {string[]} */
    const time = [];
    /** @type {(number | null)[]} */
    const temperature_2m = [];
    /** @type {number[]} */
    const precipitation_probability = [];
    /** @type {number[]} */
    const wind_speed_10m = [];
    /** @type {number[]} */
    const weather_code = [];
    /** @type {number[]} */
    const is_day = [];
    /** @type {number[]} */
    const thunderstorm_probability = [];

    const start = new Date(day1Rise).getTime();
    const setMs = new Date(day1Set).getTime();
    for (let i = 0; i < 18; i += 1) {
      const t = new Date(start + i * 3600_000);
      time.push(t.toISOString());
      // Omit hourly temps so summarizeIndices falls back to daily hi/lo for the calendar day.
      temperature_2m.push(null);
      precipitation_probability.push(10);
      wind_speed_10m.push(8);
      weather_code.push(1);
      thunderstorm_probability.push(0);
      is_day.push(t.getTime() >= start && t.getTime() < setMs ? 1 : 0);
    }

    const hourly = {
      time,
      temperature_2m,
      precipitation_probability,
      wind_speed_10m,
      weather_code,
      is_day,
      thunderstorm_probability,
    };
    const daily = {
      time: ['2026-07-21', '2026-07-22', '2026-07-23'],
      sunrise: [day0Rise, day1Rise, day2Rise],
      sunset: [day0Set, day1Set],
      temperature_2m_max: [99, 88, 91],
      temperature_2m_min: [71, 64, 65],
    };

    // Mid-afternoon Jul 22 MDT
    const nowMs = new Date('2026-07-22T20:00:00Z').getTime();
    assert.equal(dailyIndexForNow(daily, nowMs), 1);
    const periods = buildPeriodSummaries(hourly, daily, { nowMs });
    const today = periods.find((p) => p.id === 'today');
    assert.ok(today);
    assert.equal(today.temp_high_f, 88);
    assert.equal(today.temp_low_f, 64);
  });
});

describe('resolveAstronomy', () => {
  it('recomputes for wall-clock Denver date instead of stale payload date', () => {
    const lat = 40.1672;
    const lon = -105.1019;
    const stale = buildAstronomy(lat, lon, new Date('2026-07-21T01:00:00Z'));
    assert.equal(stale.date, '2026-07-20'); // evening MDT Jul 20

    const data = { lat, lon, astronomy: stale };
    const nowMs = new Date('2026-07-22T12:00:00Z').getTime(); // Jul 22 06:00 MDT
    const live = resolveAstronomy(data, nowMs);
    assert.ok(live);
    assert.equal(live.date, '2026-07-22');
    assert.notEqual(live.sunrise, stale.sunrise);
  });

  it('falls back to payload when lat/lon missing', () => {
    const astronomy = { date: '2026-07-21', sunrise: 'x' };
    assert.deepEqual(resolveAstronomy({ astronomy }, Date.now()), astronomy);
    assert.equal(resolveAstronomy({}, Date.now()), null);
  });
});

describe('resolveRfComms', () => {
  it('recomputes ducting from nearest-hour 850 mb + live current', () => {
    const hourly = {
      time: ['2026-07-21T19:00', '2026-07-22T06:00', '2026-07-22T07:00'],
      // °C — morning 20°C (~68°F) aloft vs cool surface favors ducting
      temperature_850hPa: [15, 20, 20],
    };
    const hotCurrent = { temp_f: 93, wind_speed_mph: 5, wind_gust_mph: 8 };
    const coolCurrent = { temp_f: 55, wind_speed_mph: 5, wind_gust_mph: 8 };
    const nowMs = new Date('2026-07-22T12:16:00').getTime();

    const hotRf = resolveRfComms(hotCurrent, hourly, 5000, null, nowMs);
    assert.ok(hotRf);
    assert.notEqual(hotRf.status, 'ducting_likely');

    const coolRf = resolveRfComms(coolCurrent, hourly, 5000, { status: 'nominal' }, nowMs);
    assert.ok(coolRf);
    assert.equal(coolRf.status, 'ducting_likely');
  });

  it('falls back to payload when 850 series missing', () => {
    const fallback = { status: 'nominal', detail: 'payload' };
    const rf = resolveRfComms({ temp_f: 70 }, { time: [] }, 5000, fallback);
    assert.equal(rf, fallback);
  });
});
