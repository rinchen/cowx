import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignPwsFromStations, parseNearbyStations } from '../scripts/fetch/adapters/cwop.js';
import { mergeSynopticIntoPws, parseSynopticLatest } from '../scripts/fetch/adapters/synoptic.js';

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

describe('Synoptic merge', () => {
  it('parses latest payload', () => {
    const stations = parseSynopticLatest({
      SUMMARY: { RESPONSE_CODE: 1 },
      STATION: [
        {
          STID: 'KDEN',
          NAME: 'Denver',
          LATITUDE: '39.85',
          LONGITUDE: '-104.67',
          SHORTNAME: 'ASOS',
          OBSERVATIONS: {
            air_temp_value_1: { value: '88', date_time: '2026-07-20T18:00:00Z' },
            relative_humidity_value_1: { value: '25' },
            wind_speed_value_1: { value: '10' },
          },
        },
      ],
    });
    assert.equal(stations.length, 1);
    assert.equal(stations[0].temp_f, 88);
  });

  it('prefers closer Synoptic over CWOP', () => {
    const existing = {
      primary: {
        callsign: 'CW1',
        network: 'CWOP/APRS',
        distance_km: 25,
        temp_f: 70,
      },
      nearby: [],
      links: { aprs: 'https://aprs.fi/', wunderground: null },
    };
    const merged = mergeSynopticIntoPws(existing, {
      callsign: 'BOU',
      network: 'RAWS',
      lat: 40.0,
      lon: -105.0,
      temp_f: 72,
      humidity: 20,
      pressure_mb: null,
      wind_speed_mph: 5,
      wind_gust_mph: null,
      wind_dir_deg: null,
      observed: '2026-07-20T18:00:00Z',
      distance_km: 5,
    });
    assert.equal(merged.primary.callsign, 'BOU');
    assert.match(merged.primary.network, /Synoptic/);
  });

  it('skips when token missing is handled by fetchSynoptic', async () => {
    const { fetchSynoptic } = await import('../scripts/fetch/adapters/synoptic.js');
    const result = await fetchSynoptic([], {});
    assert.equal(result.status, 'skipped');
  });
});
