import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDailyToDoy,
  buildClimatologyPayload,
  climateDoyIndex,
  climatologyIsFresh,
  createDoyAccumulators,
  accumulateDailyIntoDoy,
  finalizeDoyAccumulators,
  fetchOpenMeteoClimatology,
  yearSlices,
  CLIMATOLOGY_MAX_AGE_MS,
} from '../scripts/fetch/adapters/openmeteo-climatology.js';
import {
  compareDailyToNormal,
  deltaVsNormal,
  formatTempDelta,
  formatTodayVsTypical,
  formatVsTypicalShort,
  normalForDate,
  climateDoyIndex as clientDoyIndex,
} from '../public/js/climatology.js';

describe('climateDoyIndex', () => {
  it('maps Jan 1 and Dec 31 to ends of the climate calendar', () => {
    assert.equal(climateDoyIndex('2020-01-01'), 0);
    assert.equal(climateDoyIndex('2020-12-31'), 365);
    assert.equal(climateDoyIndex('2019-12-31'), 365);
  });

  it('reserves slot 59 for Feb 29 and keeps March 1 aligned', () => {
    assert.equal(climateDoyIndex('2020-02-29'), 59);
    assert.equal(climateDoyIndex('2020-03-01'), 60);
    assert.equal(climateDoyIndex('2019-03-01'), 60);
    assert.equal(climateDoyIndex('2019-02-28'), 58);
  });

  it('matches client helper', () => {
    assert.equal(clientDoyIndex('2024-07-21'), climateDoyIndex('2024-07-21'));
  });
});

describe('aggregateDailyToDoy', () => {
  it('averages matching calendar days across years', () => {
    const doy = aggregateDailyToDoy({
      time: ['2019-07-21', '2020-07-21', '2020-02-29'],
      temperature_2m_max: [80, 90, 40],
      temperature_2m_min: [50, 60, 20],
      precipitation_sum: [0.1, 0.3, 0],
    });
    const jul = climateDoyIndex('2020-07-21');
    assert.equal(jul, 202); // 31+29+31+30+31+30+21 - 1 = 202
    assert.equal(doy.temperature_2m_max[jul], 85);
    assert.equal(doy.temperature_2m_min[jul], 55);
    assert.equal(doy.precipitation_sum[jul], 0.2);
    assert.equal(doy.temperature_2m_max[59], 40);
  });
});

describe('doy accumulators', () => {
  it('finalize matches aggregateDailyToDoy', () => {
    const daily = {
      time: ['2018-01-01', '2019-01-01'],
      temperature_2m_max: [30, 40],
      temperature_2m_min: [10, 20],
      precipitation_sum: [0.2, 0.4],
    };
    const acc = createDoyAccumulators();
    accumulateDailyIntoDoy(acc, daily);
    assert.deepEqual(finalizeDoyAccumulators(acc), aggregateDailyToDoy(daily));
  });
});

describe('yearSlices', () => {
  it('splits the normals window into 5-year chunks', () => {
    const slices = yearSlices('1991-01-01', '2020-12-31', 5);
    assert.equal(slices[0].start, '1991-01-01');
    assert.equal(slices[0].end, '1995-12-31');
    assert.equal(slices.at(-1)?.start, '2016-01-01');
    assert.equal(slices.at(-1)?.end, '2020-12-31');
    assert.equal(slices.length, 6);
  });
});

describe('climatologyIsFresh', () => {
  it('requires doy arrays and recent fetchedAt', () => {
    const doy = aggregateDailyToDoy({
      time: Array.from({ length: 366 }, (_, i) => {
        const d = new Date(Date.UTC(2020, 0, 1 + i));
        return d.toISOString().slice(0, 10);
      }),
      temperature_2m_max: Array(366).fill(70),
      temperature_2m_min: Array(366).fill(40),
      precipitation_sum: Array(366).fill(0),
    });
    const payload = buildClimatologyPayload(doy, new Date().toISOString());
    assert.equal(climatologyIsFresh(payload), true);
    assert.equal(
      climatologyIsFresh({
        ...payload,
        fetchedAt: new Date(Date.now() - CLIMATOLOGY_MAX_AGE_MS - 1000).toISOString(),
      }),
      false,
    );
    assert.equal(climatologyIsFresh(null), false);
  });
});

describe('fetchOpenMeteoClimatology', () => {
  it('maps mocked archive responses into climatology payloads', async () => {
    const locs = [
      {
        slug: 'test-town',
        name: 'Test',
        lat: 40,
        lon: -105,
        region: 'front-range',
        county: 'Boulder',
        wfo: 'BOU',
        elevation_ft: 5000,
      },
    ];
    /** Build one leap year of daily rows so finalize passes the fill threshold. */
    const time = [];
    const temperature_2m_max = [];
    const temperature_2m_min = [];
    const precipitation_sum = [];
    for (let i = 0; i < 366; i += 1) {
      const d = new Date(Date.UTC(2020, 0, 1 + i));
      time.push(d.toISOString().slice(0, 10));
      temperature_2m_max.push(70 + (i % 10));
      temperature_2m_min.push(40 + (i % 8));
      precipitation_sum.push(0.05);
    }
    /** @type {string[]} */
    const urls = [];
    const result = await fetchOpenMeteoClimatology(locs, {
      maxLocs: 1,
      periodStart: '2020-01-01',
      periodEnd: '2020-12-31',
      sleepFn: async () => {},
      fetchJsonFn: async (url) => {
        urls.push(String(url));
        return {
          daily: { time, temperature_2m_max, temperature_2m_min, precipitation_sum },
        };
      },
    });
    assert.ok(urls.length >= 1);
    assert.equal(result.status, 'ok');
    assert.equal(result.bySlug.size, 1);
    const climo = result.bySlug.get('test-town');
    assert.equal(climo?.source, 'open-meteo-era5');
    assert.equal(climo?.doy.temperature_2m_max.length, 366);
    assert.ok(climo?.doy.temperature_2m_max[0] != null);
  });
});

describe('client compare helpers', () => {
  const doy = {
    temperature_2m_max: Array(366).fill(null),
    temperature_2m_min: Array(366).fill(null),
    precipitation_sum: Array(366).fill(null),
  };
  const jul = climateDoyIndex('2026-07-21');
  doy.temperature_2m_max[jul] = 82;
  doy.temperature_2m_min[jul] = 55;
  doy.precipitation_sum[jul] = 0.05;
  const climatology = buildClimatologyPayload(doy);

  it('looks up normals and deltas', () => {
    const n = normalForDate(climatology, '2026-07-21');
    assert.deepEqual(n, { tmax: 82, tmin: 55, precip: 0.05 });
    assert.equal(deltaVsNormal(88, 82), 6);
    assert.equal(formatTempDelta(6), '+6°');
    assert.equal(formatTempDelta(-3.2), '−3°');
    assert.equal(formatVsTypicalShort(0.5), 'near typical');
    assert.equal(formatTodayVsTypical(88, 58, n), 'High +6° · Low +3° vs typical');
  });

  it('compareDailyToNormal returns labels', () => {
    const cmp = compareDailyToNormal(climatology, '2026-07-21', 88, 52, 0.2);
    assert.equal(cmp.deltaHi, 6);
    assert.equal(cmp.deltaLo, -3);
    assert.ok(cmp.vsTypicalLabel?.includes('+6°'));
    assert.ok(cmp.precipLabel?.includes('vs typical'));
  });
});
