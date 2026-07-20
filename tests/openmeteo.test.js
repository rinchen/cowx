import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignThunderstormByTime,
  dailyMaxThunderstorm,
  mapResult,
  mergeThunderstormProbability,
  nearestThunderstormPct,
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
