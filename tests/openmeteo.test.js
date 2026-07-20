import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignThunderstormByTime,
  dailyMaxThunderstorm,
  mapResult,
  mergeThunderstormProbability,
  nearestThunderstormPct,
  precipTodayInches,
  wmoLabel,
} from '../scripts/fetch/adapters/openmeteo.js';

describe('mapResult wind fields', () => {
  it('maps hourly and daily wind direction', () => {
    const mapped = mapResult(
      {
        current: {
          temperature_2m: 70,
          apparent_temperature: 68,
          relative_humidity_2m: 40,
          weather_code: 0,
          cloud_cover: 10,
          pressure_msl: 1010,
          wind_speed_10m: 8,
          wind_direction_10m: 45,
          wind_gusts_10m: 12,
          precipitation: 0,
          uv_index: 3,
        },
        hourly: {
          time: ['2026-07-20T12:00', '2026-07-20T13:00'],
          temperature_2m: [70, 72],
          apparent_temperature: [68, 70],
          precipitation_probability: [10, 20],
          precipitation: [0, 0],
          weather_code: [0, 2],
          wind_speed_10m: [8, 10],
          wind_direction_10m: [45, 90],
          wind_gusts_10m: [12, 14],
          relative_humidity_2m: [40, 38],
          dewpoint_2m: [40, 41],
          cloud_cover: [10, 20],
          visibility: [16000, 16000],
          uv_index: [3, 4],
        },
        daily: {
          time: ['2026-07-20'],
          weather_code: [2],
          temperature_2m_max: [80],
          temperature_2m_min: [55],
          precipitation_sum: [0],
          precipitation_probability_max: [20],
          wind_speed_10m_max: [15],
          wind_gusts_10m_max: [22],
          wind_direction_10m_dominant: [60],
          uv_index_max: [8],
          sunrise: ['2026-07-20T05:45'],
          sunset: ['2026-07-20T20:20'],
        },
      },
      wmoLabel(0),
    );

    assert.equal(mapped.current.wind_dir_deg, 45);
    assert.deepEqual(mapped.hourly.wind_direction_10m, [45, 90]);
    assert.deepEqual(mapped.daily.wind_direction_10m_dominant, [60]);
    assert.equal(mapped.current.thunderstorm_probability, null);
    assert.deepEqual(mapped.hourly.thunderstorm_probability, []);
  });

  it('maps enriched current/hourly/daily fields when present', () => {
    const mapped = mapResult(
      {
        current: {
          temperature_2m: 70,
          apparent_temperature: 68,
          relative_humidity_2m: 40,
          weather_code: 0,
          cloud_cover: 10,
          pressure_msl: 1010,
          surface_pressure: 820,
          is_day: 1,
          wind_speed_10m: 8,
          wind_direction_10m: 45,
          wind_gusts_10m: 12,
          precipitation: 0,
          uv_index: 3,
          dewpoint_2m: 42,
          visibility: 16093,
        },
        hourly: {
          time: ['2026-07-20T12:00'],
          temperature_2m: [70],
          apparent_temperature: [68],
          precipitation_probability: [10],
          precipitation: [0.05],
          rain: [0],
          showers: [0],
          snowfall: [0.1],
          weather_code: [0],
          wind_speed_10m: [8],
          wind_direction_10m: [45],
          wind_gusts_10m: [12],
          wind_speed_80m: [15],
          wind_direction_80m: [50],
          relative_humidity_2m: [40],
          dewpoint_2m: [40],
          cloud_cover: [10],
          cloud_cover_low: [5],
          cloud_cover_mid: [10],
          cloud_cover_high: [20],
          visibility: [16000],
          uv_index: [3],
          soil_temperature_6cm: [55],
          soil_moisture_3_to_9cm: [0.2],
          cape: [800],
          shortwave_radiation: [400],
          freezing_level_height: [3500],
          is_day: [1],
        },
        daily: {
          time: ['2026-07-20'],
          weather_code: [2],
          temperature_2m_max: [80],
          temperature_2m_min: [55],
          apparent_temperature_max: [78],
          apparent_temperature_min: [53],
          precipitation_sum: [0],
          precipitation_probability_max: [20],
          precipitation_hours: [2],
          snowfall_sum: [0.5],
          wind_speed_10m_max: [15],
          wind_gusts_10m_max: [22],
          wind_direction_10m_dominant: [60],
          uv_index_max: [8],
          sunrise: ['2026-07-20T05:45'],
          sunset: ['2026-07-20T20:20'],
          sunshine_duration: [36000],
          daylight_duration: [50400],
          shortwave_radiation_sum: [20],
          et0_fao_evapotranspiration: [0.25],
        },
      },
      'Clear',
    );

    assert.equal(mapped.current.surface_pressure_mb, 820);
    assert.equal(mapped.current.is_day, 1);
    assert.equal(mapped.current.dewpoint_f, 42);
    assert.equal(mapped.current.visibility_m, 16093);
    assert.deepEqual(mapped.hourly.snowfall, [0.1]);
    assert.deepEqual(mapped.hourly.cape, [800]);
    assert.deepEqual(mapped.hourly.freezing_level_height, [3500]);
    assert.deepEqual(mapped.hourly.cloud_cover_low, [5]);
    assert.deepEqual(mapped.daily.snowfall_sum, [0.5]);
    assert.deepEqual(mapped.daily.et0_fao_evapotranspiration, [0.25]);
    assert.deepEqual(mapped.daily.daylight_duration, [50400]);
  });

  it('sums precip_today from hourly through current Denver hour', () => {
    // 2026-07-20T20:30Z = 14:30 MDT → include hours ≤ 14
    const nowMs = new Date('2026-07-20T20:30:00Z').getTime();
    const sum = precipTodayInches(
      ['2026-07-20T06:00', '2026-07-20T12:00', '2026-07-20T18:00', '2026-07-21T06:00'],
      [0.1, 0.2, 0.05, 0.9],
      nowMs,
    );
    assert.equal(sum, 0.3);
  });
});

describe('thunderstorm merge helpers', () => {
  it('aligns NBM pct by timestamp', () => {
    const aligned = alignThunderstormByTime(
      ['2026-07-20T12:00', '2026-07-20T13:00', '2026-07-20T14:00'],
      ['2026-07-20T12:00', '2026-07-20T14:00'],
      [5, 40],
    );
    assert.deepEqual(aligned, [5, null, 40]);
  });

  it('computes daily max from hourly', () => {
    const maxes = dailyMaxThunderstorm(
      ['2026-07-20T12:00', '2026-07-20T18:00', '2026-07-21T12:00'],
      [5, 40, 10],
      ['2026-07-20', '2026-07-21'],
    );
    assert.deepEqual(maxes, [40, 10]);
  });

  it('picks nearest hour for current pct', () => {
    const now = new Date('2026-07-20T13:10:00Z').getTime();
    const pct = nearestThunderstormPct(
      ['2026-07-20T12:00:00Z', '2026-07-20T13:00:00Z', '2026-07-20T14:00:00Z'],
      [1, 22, 3],
      now,
    );
    assert.equal(pct, 22);
  });

  it('merges NBM into payload without dropping wind', () => {
    const payload = mapResult(
      {
        current: {
          temperature_2m: 70,
          apparent_temperature: 68,
          relative_humidity_2m: 40,
          weather_code: 0,
          cloud_cover: 10,
          pressure_msl: 1010,
          wind_speed_10m: 8,
          wind_direction_10m: 45,
          wind_gusts_10m: 12,
          precipitation: 0,
          uv_index: 3,
        },
        hourly: {
          time: ['2026-07-20T12:00', '2026-07-20T13:00'],
          temperature_2m: [70, 72],
          apparent_temperature: [68, 70],
          precipitation_probability: [10, 20],
          precipitation: [0, 0],
          weather_code: [0, 2],
          wind_speed_10m: [8, 10],
          wind_direction_10m: [45, 90],
          wind_gusts_10m: [12, 14],
          relative_humidity_2m: [40, 38],
          dewpoint_2m: [40, 41],
          cloud_cover: [10, 20],
          visibility: [16000, 16000],
          uv_index: [3, 4],
        },
        daily: {
          time: ['2026-07-20'],
          weather_code: [2],
          temperature_2m_max: [80],
          temperature_2m_min: [55],
          precipitation_sum: [0],
          precipitation_probability_max: [20],
          wind_speed_10m_max: [15],
          wind_gusts_10m_max: [22],
          wind_direction_10m_dominant: [60],
          uv_index_max: [8],
          sunrise: ['2026-07-20T05:45'],
          sunset: ['2026-07-20T20:20'],
        },
      },
      'Clear',
    );

    mergeThunderstormProbability(payload, {
      time: ['2026-07-20T12:00', '2026-07-20T13:00'],
      thunderstorm_probability: [6, 18],
    });

    assert.deepEqual(payload.hourly.thunderstorm_probability, [6, 18]);
    assert.deepEqual(payload.daily.thunderstorm_probability_max, [18]);
    assert.equal(payload.hourly.wind_direction_10m[0], 45);
    assert.ok(
      payload.current.thunderstorm_probability === 6 ||
        payload.current.thunderstorm_probability === 18,
    );
  });

  it('leaves wind intact when NBM hourly is missing', () => {
    const payload = mapResult(
      {
        current: {
          temperature_2m: 70,
          apparent_temperature: 68,
          relative_humidity_2m: 40,
          weather_code: 0,
          cloud_cover: 10,
          pressure_msl: 1010,
          wind_speed_10m: 8,
          wind_direction_10m: 45,
          wind_gusts_10m: 12,
          precipitation: 0,
          uv_index: 3,
        },
        hourly: {
          time: ['2026-07-20T12:00'],
          temperature_2m: [70],
          apparent_temperature: [68],
          precipitation_probability: [10],
          precipitation: [0],
          weather_code: [0],
          wind_speed_10m: [8],
          wind_direction_10m: [45],
          wind_gusts_10m: [12],
          relative_humidity_2m: [40],
          dewpoint_2m: [40],
          cloud_cover: [10],
          visibility: [16000],
          uv_index: [3],
        },
        daily: {
          time: ['2026-07-20'],
          weather_code: [0],
          temperature_2m_max: [80],
          temperature_2m_min: [55],
          precipitation_sum: [0],
          precipitation_probability_max: [10],
          wind_speed_10m_max: [15],
          wind_gusts_10m_max: [22],
          wind_direction_10m_dominant: [60],
          uv_index_max: [8],
          sunrise: ['2026-07-20T05:45'],
          sunset: ['2026-07-20T20:20'],
        },
      },
      'Clear',
    );

    mergeThunderstormProbability(payload, null);
    assert.deepEqual(payload.hourly.wind_direction_10m, [45]);
    assert.deepEqual(payload.hourly.thunderstorm_probability, []);
    assert.equal(payload.current.thunderstorm_probability, null);
  });
});
