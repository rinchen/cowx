import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bottomLineJumpTarget, synthesizeBottomLine } from '../public/js/bottom-line.js';

describe('synthesizeBottomLine', () => {
  it('prioritizes severe NWS warnings', () => {
    const { headline, priority, jumpTo } = synthesizeBottomLine({
      current: { humidity: 12, wind_gust_mph: 40, temp_f: 90, condition: 'Clear' },
      alerts: [{ event: 'Red Flag Warning', severity: 'Severe', headline: 'Red Flag Warning' }],
    });
    assert.equal(priority, 'hazard');
    assert.equal(jumpTo, 'alerts-heading');
    assert.match(headline, /Red Flag/i);
    assert.match(headline, /12%/);
  });

  it('flags strong winds for travel', () => {
    const { headline, priority } = synthesizeBottomLine({
      name: 'Vail Pass',
      elevation_ft: 10600,
      region: 'mountains',
      current: { wind_speed_mph: 22, wind_gust_mph: 38, condition: 'Windy', humidity: 40 },
      alerts: [],
      hourly: { time: [] },
    });
    assert.equal(priority, 'wind');
    assert.match(headline, /38/);
    assert.match(headline, /pass|mountain/i);
  });

  it('reports upcoming precip timing', () => {
    const now = new Date();
    const times = [];
    for (let i = 0; i < 8; i += 1) {
      const t = new Date(now.getTime() + i * 3600_000);
      times.push(t.toISOString().slice(0, 16));
    }
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 5, condition: 'Cloudy', humidity: 50, temp_f: 45 },
      alerts: [],
      hourly: {
        time: times,
        precipitation_probability: [10, 20, 55, 70, 40, 20, 10, 5],
        precipitation: [0, 0, 0.05, 0.1, 0, 0, 0, 0],
        rain: [0, 0, 0.05, 0.1, 0, 0, 0, 0],
        snowfall: [0, 0, 0, 0, 0, 0, 0, 0],
        temperature_2m: [45, 44, 43, 42, 41, 40, 39, 38],
      },
    });
    assert.equal(priority, 'precip');
    assert.match(headline, /Rain|Precipitation/i);
  });

  it('flags elevated AQI', () => {
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 5, condition: 'Haze', humidity: 30, temp_f: 80 },
      alerts: [],
      hourly: { time: [] },
      airnow: { aqi: 155, category: 'Unhealthy' },
    });
    assert.equal(priority, 'aq');
    assert.match(headline, /155/);
  });

  it('flags CDOT chain law / closures for travel', () => {
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 5, condition: 'Clear', humidity: 40, temp_f: 30 },
      alerts: [],
      hourly: { time: [] },
      cdot_roads: {
        alerts: [
          {
            title: 'I-70 chain law',
            chain_law: true,
            closure: false,
            distance_km: 12,
          },
        ],
      },
    });
    assert.equal(priority, 'travel');
    assert.match(headline, /Chain law/i);
  });

  it('flags HMS medium/heavy smoke', () => {
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 5, condition: 'Haze', humidity: 30, temp_f: 80 },
      alerts: [],
      hourly: { time: [] },
      hms_smoke: { density: 'heavy', observed: '2026-07-20' },
    });
    assert.equal(priority, 'smoke');
    assert.match(headline, /smoke/i);
  });

  it('flags SPC critical fire weather', () => {
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 10, condition: 'Clear', humidity: 25, temp_f: 80 },
      alerts: [],
      hourly: { time: [] },
      fire_weather: {
        day1: { windRh: 'critical', dryT: 'none' },
        day2: { windRh: 'none', dryT: 'none' },
      },
    });
    assert.equal(priority, 'fire');
    assert.match(headline, /critical/i);
  });

  it('flags county burn restriction reported', () => {
    const { headline, priority, jumpTo } = synthesizeBottomLine({
      county: 'Jefferson',
      current: { wind_speed_mph: 5, condition: 'Clear', humidity: 40, temp_f: 70 },
      alerts: [],
      hourly: { time: [] },
      fire_restrictions: { status: 'restriction_reported', county: 'Jefferson' },
    });
    assert.equal(priority, 'fire');
    assert.equal(jumpTo, 'smoke-heading');
    assert.match(headline, /Jefferson/i);
    assert.match(headline, /restriction/i);
  });

  it('falls back to nominal pleasant summary', () => {
    const { headline, priority, jumpTo } = synthesizeBottomLine({
      current: { wind_speed_mph: 4, condition: 'Clear', humidity: 35, temp_f: 72 },
      alerts: [],
      hourly: { time: [] },
    });
    assert.equal(priority, 'nominal');
    assert.equal(jumpTo, null);
    assert.match(headline, /Clear/);
    assert.match(headline, /ideal outdoor/i);
  });

  it('uses nearest-hour sky when current snapshot is still Clear', () => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const h = now.getHours();
    /** @param {number} hour */
    const localHour = (hour) =>
      `${y}-${mo}-${day}T${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;
    const { headline, priority } = synthesizeBottomLine({
      current: { wind_speed_mph: 4, condition: 'Clear', humidity: 35, temp_f: 72, weather_code: 0 },
      alerts: [],
      hourly: {
        time: [localHour(h - 1), localHour(h), localHour(h + 1)],
        weather_code: [0, 3, 3],
        is_day: [1, 1, 1],
      },
    });
    assert.equal(priority, 'nominal');
    assert.match(headline, /Overcast/);
    assert.doesNotMatch(headline, /^Clear/);
  });
});

describe('bottomLineJumpTarget', () => {
  it('maps priorities to deep sections', () => {
    assert.equal(bottomLineJumpTarget('hazard'), 'alerts-heading');
    assert.equal(bottomLineJumpTarget('fire'), 'smoke-heading');
    assert.equal(bottomLineJumpTarget('travel'), 'roads-heading');
    assert.equal(bottomLineJumpTarget('aq'), 'aqi-heading');
    assert.equal(bottomLineJumpTarget('nominal'), null);
  });
});
