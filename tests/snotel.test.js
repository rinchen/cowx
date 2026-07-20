import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignNearestSnotel,
  filterCoSnotelStations,
  mergeSnotelData,
  precip24hFromPrec,
} from '../scripts/fetch/adapters/snotel.js';

describe('snotel helpers', () => {
  it('filters CO SNTL stations', () => {
    const stations = filterCoSnotelStations([
      {
        stationTriplet: '1130:CO:SNTL',
        stationId: '1130',
        stateCode: 'CO',
        networkCode: 'SNTL',
        name: 'Berthoud Summit',
        latitude: 39.8,
        longitude: -105.78,
        elevation: 11300,
      },
      {
        stationTriplet: '1:WY:SNTL',
        stationId: '1',
        stateCode: 'WY',
        networkCode: 'SNTL',
        name: 'Wyoming',
        latitude: 41,
        longitude: -110,
        elevation: 9000,
      },
    ]);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].station_id, '1130');
  });

  it('computes 24h precip from cumulative PREC', () => {
    assert.equal(
      precip24hFromPrec([
        { date: '2026-07-18', value: 24.0 },
        { date: '2026-07-19', value: 24.3 },
      ]),
      0.3,
    );
    assert.equal(precip24hFromPrec([{ date: '2026-07-19', value: 24.0 }]), null);
  });

  it('merges data and assigns nearest high-elevation site', () => {
    const stations = filterCoSnotelStations([
      {
        stationTriplet: '1130:CO:SNTL',
        stationId: '1130',
        stateCode: 'CO',
        networkCode: 'SNTL',
        name: 'Berthoud Summit',
        latitude: 39.8,
        longitude: -105.78,
        elevation: 11300,
      },
    ]);
    const merged = mergeSnotelData(stations, [
      {
        stationTriplet: '1130:CO:SNTL',
        data: [
          {
            stationElement: { elementCode: 'SNWD' },
            values: [{ date: '2026-07-19', value: 12 }],
          },
          {
            stationElement: { elementCode: 'WTEQ' },
            values: [{ date: '2026-07-19', value: 4.2 }],
          },
          {
            stationElement: { elementCode: 'TOBS' },
            values: [{ date: '2026-07-19', value: 38 }],
          },
          {
            stationElement: { elementCode: 'PREC' },
            values: [
              { date: '2026-07-18', value: 10 },
              { date: '2026-07-19', value: 10 },
            ],
          },
        ],
      },
    ]);
    assert.equal(merged.get('1130:CO:SNTL').snow_depth_in, 12);
    assert.equal(merged.get('1130:CO:SNTL').swe_in, 4.2);

    const bySlug = assignNearestSnotel(
      [
        {
          slug: 'berthoud-pass',
          name: 'Berthoud Pass',
          lat: 39.8,
          lon: -105.78,
          elevation_ft: 11307,
        },
        { slug: 'denver', name: 'Denver', lat: 39.74, lon: -104.99, elevation_ft: 5280 },
      ],
      merged,
    );
    assert.equal(bySlug.size, 1);
    assert.equal(bySlug.get('berthoud-pass').station_id, '1130');
    assert.equal(bySlug.has('denver'), false);
  });
});
