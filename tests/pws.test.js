import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignPwsFromStations, parseNearbyStations } from '../scripts/fetch/adapters/cwop.js';

describe('CWOP PWS assign', () => {
  it('parses nearby stations', () => {
    const stations = parseNearbyStations([
      {
        callsign: 'CW1234',
        position: { lat: 40.17, lon: -105.1 },
        weather: { temperature: 72, humidity: 30, wind_speed: 5 },
        last_report: '2026-07-20T12:00:00Z',
      },
    ]);
    assert.equal(stations.length, 1);
    assert.equal(stations[0].temp_f, 72);
  });

  it('assigns up to 2 stations within 60 km', () => {
    const stations = [
      {
        callsign: 'A',
        lat: 40.17,
        lon: -105.1,
        temp_f: 70,
        humidity: 20,
        pressure_mb: null,
        wind_speed_mph: 3,
        wind_gust_mph: null,
        wind_dir_deg: null,
        observed: null,
      },
      {
        callsign: 'B',
        lat: 40.2,
        lon: -105.05,
        temp_f: 71,
        humidity: 22,
        pressure_mb: null,
        wind_speed_mph: 4,
        wind_gust_mph: null,
        wind_dir_deg: null,
        observed: null,
      },
      {
        callsign: 'C',
        lat: 37.0,
        lon: -108.0,
        temp_f: 80,
        humidity: 10,
        pressure_mb: null,
        wind_speed_mph: 1,
        wind_gust_mph: null,
        wind_dir_deg: null,
        observed: null,
      },
    ];
    const pws = assignPwsFromStations({ lat: 40.1672, lon: -105.1019 }, stations, {
      wunderground: 'https://www.wunderground.com/dashboard/pws/KCOLONGM52',
    });
    assert.ok(pws);
    assert.equal(pws.primary.callsign, 'A');
    assert.ok(pws.nearby.length <= 1);
    assert.match(pws.links.wunderground, /KCOLONGM52/);
  });
});
