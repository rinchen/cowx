import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHourlyModalTableHtml,
  buildOutlookHighlights,
  buildPeriodSummaries,
  nearestHourIndex,
  pickNowCurrent,
  pickNowSky,
  resolveCatalogNow,
  sliceCompactHours,
  sourceStatusChips,
  sourceStatusLabel,
  sourceStatusLegendHtml,
} from '../public/js/outlook.js';

/**
 * @param {number} hours
 * @param {Date} [anchor]
 */
function makeHourly(hours, anchor = new Date('2026-07-20T12:00:00-06:00')) {
  /** @type {string[]} */
  const time = [];
  /** @type {number[]} */
  const temperature_2m = [];
  /** @type {number[]} */
  const apparent_temperature = [];
  /** @type {number[]} */
  const precipitation_probability = [];
  /** @type {number[]} */
  const wind_speed_10m = [];
  /** @type {number[]} */
  const wind_direction_10m = [];
  /** @type {number[]} */
  const wind_gusts_10m = [];
  /** @type {number[]} */
  const thunderstorm_probability = [];
  /** @type {number[]} */
  const weather_code = [];
  /** @type {number[]} */
  const is_day = [];

  for (let i = 0; i < hours; i += 1) {
    const t = new Date(anchor.getTime() + (i - 6) * 3600_000);
    time.push(t.toISOString());
    temperature_2m.push(60 + i);
    apparent_temperature.push(58 + i);
    precipitation_probability.push(i === 10 ? 80 : 10);
    wind_speed_10m.push(8 + (i % 5));
    wind_direction_10m.push(i < 12 ? 180 : 270);
    wind_gusts_10m.push(i === 20 ? 35 : 12);
    thunderstorm_probability.push(i === 15 ? 55 : 5);
    weather_code.push(i % 3 === 0 ? 61 : 1);
    is_day.push(t.getUTCHours() >= 13 && t.getUTCHours() < 25 ? 1 : 0);
  }

  return {
    time,
    temperature_2m,
    apparent_temperature,
    precipitation_probability,
    wind_speed_10m,
    wind_direction_10m,
    wind_gusts_10m,
    thunderstorm_probability,
    weather_code,
    is_day,
  };
}

describe('nearestHourIndex', () => {
  it('picks the closest ISO hour to now', () => {
    const now = new Date('2026-07-20T15:10:00Z').getTime();
    const times = [
      '2026-07-20T13:00:00Z',
      '2026-07-20T14:00:00Z',
      '2026-07-20T15:00:00Z',
      '2026-07-20T16:00:00Z',
    ];
    assert.equal(nearestHourIndex(times, now), 2);
  });

  it('treats offset-less Open-Meteo times as America/Denver', () => {
    // 12:16 MDT = 18:16Z — must pick 12:00 local, not 18:00 (which UTC hosts mis-parse).
    const nowMs = new Date('2026-07-22T18:16:00Z').getTime();
    const times = ['2026-07-22T12:00', '2026-07-22T18:00'];
    assert.equal(nearestHourIndex(times, nowMs), 0);
  });

  it('returns 0 for empty series', () => {
    assert.equal(nearestHourIndex([]), 0);
  });
});

describe('pickNowSky', () => {
  it('returns Overcast from nearest hour when earlier hour was Clear', () => {
    const hourly = {
      time: ['2026-07-21T06:00:00', '2026-07-21T07:00:00', '2026-07-21T08:00:00'],
      weather_code: [0, 3, 3],
      is_day: [1, 1, 1],
    };
    const nowMs = new Date('2026-07-21T13:36:00Z').getTime(); // 07:36 MDT
    const sky = pickNowSky(hourly, nowMs);
    assert.ok(sky);
    assert.equal(sky.weather_code, 3);
    assert.equal(sky.condition, 'Overcast');
    assert.equal(sky.is_day, true);
  });

  it('returns null when hourly times are missing', () => {
    assert.equal(pickNowSky(null), null);
    assert.equal(pickNowSky({ weather_code: [0] }), null);
    assert.equal(pickNowSky({ time: [] }), null);
  });

  it('labels missing weather_code via wmoLabel', () => {
    const hourly = {
      time: ['2026-07-21T12:00:00'],
      weather_code: [null],
      is_day: [0],
    };
    const sky = pickNowSky(hourly, new Date('2026-07-21T18:00:00Z').getTime()); // 12:00 MDT
    assert.ok(sky);
    assert.equal(sky.weather_code, null);
    assert.equal(sky.condition, '—');
    assert.equal(sky.is_day, false);
  });
});

describe('pickNowCurrent / resolveCatalogNow', () => {
  it('uses nearest-hour temp instead of the fetch-time snapshot', () => {
    const hourly = {
      time: ['2026-07-21T19:00:00', '2026-07-22T06:00:00', '2026-07-22T07:00:00'],
      temperature_2m: [93.4, 67.4, 70.1],
      apparent_temperature: [88.1, 68.9, 71.7],
      weather_code: [0, 3, 3],
      relative_humidity_2m: [25, 55, 50],
      wind_speed_10m: [14.1, 4.2, 5.0],
      wind_direction_10m: [105, 220, 230],
      wind_gusts_10m: [21.3, 8.0, 9.0],
      cloud_cover: [0, 100, 90],
      is_day: [1, 1, 1],
    };
    const snapshot = {
      temp_f: 93.4,
      feels_like_f: 88.1,
      condition: 'Clear',
      weather_code: 0,
      precip_today_in: 0.12,
      surface_pressure_mb: 850.2,
    };
    const nowMs = new Date('2026-07-22T12:16:00Z').getTime(); // 06:16 MDT
    const fromHour = pickNowCurrent(hourly, nowMs);
    assert.ok(fromHour);
    assert.equal(fromHour.temp_f, 67.4);
    assert.equal(fromHour.feels_like_f, 68.9);
    assert.equal(fromHour.condition, 'Overcast');
    assert.equal(fromHour.cloud_cover, 100);

    const merged = resolveCatalogNow(snapshot, hourly, nowMs);
    assert.ok(merged);
    assert.equal(merged.temp_f, 67.4);
    assert.equal(merged.condition, 'Overcast');
    // surface_pressure stays from the snapshot (not in hourly).
    assert.equal(merged.surface_pressure_mb, 850.2);
  });

  it('recomputes precip_today_in from hourly for the Denver calendar day', () => {
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
      weather_code: [0, 3, 3, 0, 0],
      is_day: [1, 1, 1, 1, 1],
    };
    const snapshot = { temp_f: 90, precip_today_in: 9.99 };
    // 12:16 MDT = 18:16Z on Jul 22
    const nowMs = new Date('2026-07-22T18:16:00Z').getTime();
    const merged = resolveCatalogNow(snapshot, hourly, nowMs);
    assert.ok(merged);
    // Includes hours ≤ 12 local: 06 + 07 + 12 = 0.1 + 0.05 + 0.2
    assert.equal(merged.precip_today_in, 0.35);
    assert.equal(merged.temp_f, 85);
  });

  it('falls back to the snapshot when hourly is empty', () => {
    const snapshot = { temp_f: 72, precip_today_in: 0 };
    assert.deepEqual(resolveCatalogNow(snapshot, null), snapshot);
    assert.deepEqual(resolveCatalogNow(snapshot, { time: [] }), snapshot);
    assert.equal(resolveCatalogNow(null, null), null);
  });
});

describe('sliceCompactHours', () => {
  it('returns at most the requested count from nearest hour', () => {
    const hourly = makeHourly(48);
    const nowMs = new Date(hourly.time[6]).getTime();
    const rows = sliceCompactHours(hourly, { count: 10, nowMs });
    assert.equal(rows.length, 10);
    assert.equal(rows[0].time, hourly.time[6]);
    assert.ok(rows[0].temp_f != null);
    assert.ok(rows[0].feels_like_f != null);
    assert.ok(rows[0].precip_pct != null);
    assert.ok(rows[0].wind_mph != null);
  });

  it('caps count at 12', () => {
    const hourly = makeHourly(48);
    const rows = sliceCompactHours(hourly, {
      count: 20,
      nowMs: new Date(hourly.time[0]).getTime(),
    });
    assert.equal(rows.length, 12);
  });

  it('returns empty when hourly missing', () => {
    assert.deepEqual(sliceCompactHours(null), []);
  });
});

describe('buildPeriodSummaries', () => {
  it('builds today and tonight from sunrise/sunset windows', () => {
    const sr = '2026-07-20T13:00:00.000Z'; // ~07:00 MDT
    const sunsetOk = '2026-07-21T02:00:00.000Z'; // ~20:00 MDT Jul 20
    const nextRise = '2026-07-21T13:00:00.000Z';

    /** @type {string[]} */
    const time = [];
    /** @type {number[]} */
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

    const start = new Date(sr).getTime();
    const setMs = new Date(sunsetOk).getTime();
    for (let i = 0; i < 24; i += 1) {
      const t = new Date(start + i * 3600_000);
      time.push(t.toISOString());
      temperature_2m.push(50 + i);
      precipitation_probability.push(20);
      wind_speed_10m.push(10);
      weather_code.push(1);
      thunderstorm_probability.push(0);
      const ms = t.getTime();
      is_day.push(ms >= start && ms < setMs ? 1 : 0);
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
      sunrise: [sr, nextRise],
      sunset: [sunsetOk],
      temperature_2m_max: [85],
      temperature_2m_min: [55],
    };

    const periods = buildPeriodSummaries(hourly, daily, {
      nowMs: start,
    });
    assert.ok(periods.some((p) => p.id === 'today'));
    assert.ok(periods.some((p) => p.id === 'tonight'));
    const today = periods.find((p) => p.id === 'today');
    assert.ok(today?.summary);
    assert.ok(today?.temp_high_f != null);
  });
});

describe('buildOutlookHighlights', () => {
  it('reports peak thunderstorm, temp swing, wind shift, and gusts', () => {
    const hourly = makeHourly(48);
    const bullets = buildOutlookHighlights(hourly, {
      fromIndex: 0,
      hours: 48,
    });
    const ids = bullets.map((b) => b.id);
    assert.ok(ids.includes('tstorm'));
    assert.ok(ids.includes('temp'));
    assert.ok(ids.includes('wind-shift'));
    assert.ok(ids.includes('gust'));
  });

  it('returns empty when hourly missing', () => {
    assert.deepEqual(buildOutlookHighlights(null), []);
  });
});

describe('buildHourlyModalTableHtml', () => {
  it('includes required headers and up to 48 rows', () => {
    const hourly = makeHourly(60);
    const html = buildHourlyModalTableHtml(hourly, { maxRows: 48 });
    assert.match(html, /<th scope="col">Time<\/th>/);
    assert.match(html, /Temp \/ Feels Like/);
    assert.match(html, /Precip %/);
    assert.match(html, /Wind/);
    assert.match(html, /Gusts/);
    assert.match(html, /Thunderstorm Probability/);
    const rows = html.match(/<tr>/g) ?? [];
    // thead + 48 body
    assert.equal(rows.length, 49);
  });

  it('escapes untrusted content via wmo path and shows em dash for gaps', () => {
    const html = buildHourlyModalTableHtml(
      {
        time: ['2026-07-20T18:00:00Z'],
        temperature_2m: [null],
        weather_code: [0],
        is_day: [1],
      },
      { maxRows: 48 },
    );
    assert.match(html, /—/);
    assert.doesNotMatch(html, /<script/);
  });

  it('shows empty state when no times', () => {
    const html = buildHourlyModalTableHtml({ time: [] });
    assert.match(html, /unavailable/i);
  });
});

describe('sourceStatusChips', () => {
  it('maps known source ids to short labels and statuses', () => {
    const chips = sourceStatusChips([
      { id: 'openmeteo', status: 'ok' },
      { id: 'nws', status: 'partial' },
      { id: 'airnow', status: 'error' },
      { id: 'cotrip', status: 'ok' },
      { id: 'openmeteo_climatology', status: 'partial' },
      { id: 'mystery_source', status: 'skipped' },
      null,
      { status: 'ok' },
    ]);
    assert.equal(chips.length, 6);
    assert.equal(chips[0].label, 'OM');
    assert.equal(chips[0].status, 'ok');
    assert.match(chips[0].title, /Open-Meteo forecast/i);
    assert.equal(chips[1].label, 'NWS');
    assert.equal(chips[3].label, 'COtrip');
    assert.match(chips[3].title, /RWIS/i);
    assert.equal(chips[4].label, 'Climo');
    assert.match(chips[4].title, /ERA5/i);
    assert.equal(chips[5].label, 'MYSTER');
  });

  it('returns empty for non-arrays', () => {
    assert.deepEqual(sourceStatusChips(/** @type {any} */ (null)), []);
  });
});

describe('source status key', () => {
  it('labels statuses for the legend', () => {
    assert.equal(sourceStatusLabel('ok'), 'OK');
    assert.equal(sourceStatusLabel('partial'), 'Partial');
    assert.equal(sourceStatusLabel('error'), 'Error');
    assert.equal(sourceStatusLabel('skipped'), 'Skipped');
  });

  it('renders a color legend with status swatches', () => {
    const html = sourceStatusLegendHtml();
    assert.match(html, /source-legend/);
    assert.match(html, /source-chip--ok/);
    assert.match(html, /source-chip--partial/);
    assert.match(html, /source-chip--error/);
    assert.match(html, /source-chip--skipped/);
    assert.match(html, /OK/);
    assert.match(html, /Partial/);
  });
});
