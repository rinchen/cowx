import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assignEventsForLocation,
  celsiusToF,
  fetchCotrip,
  isRelevantTravelerEvent,
  mapWeatherStationSensors,
  msToMph,
  normalizeCotripOffset,
  parseRoadConditionFeature,
  parseTravelerEventFeature,
  parseWeatherStationFeature,
  sensorReadingsByType,
} from '../scripts/fetch/adapters/cotrip.js';
import { isRwisObservationFresh, rwisLiveReadings } from '../public/js/rwis.js';

describe('COtrip helpers', () => {
  it('converts SI units', () => {
    assert.equal(celsiusToF(0), 32);
    assert.equal(celsiusToF(20), 68);
    assert.ok(Math.abs(msToMph(1) - 2.2) < 0.1);
  });

  it('strips Python bytes repr from next-offset', () => {
    assert.equal(normalizeCotripOffset("b'abc=='"), 'abc==');
    assert.equal(normalizeCotripOffset('None'), null);
    assert.equal(normalizeCotripOffset(null), null);
  });

  it('maps weather station sensors', () => {
    const byType = sensorReadingsByType([
      { type: 'temperature', currentReading: '19.20' },
      { type: 'road surface temperature', currentReading: '24.10' },
      { type: 'average wind speed', currentReading: '2.40' },
      { type: 'road surface status', currentReading: '4' },
      { type: 'humidity', currentReading: '70' },
    ]);
    const mapped = mapWeatherStationSensors(byType);
    assert.equal(mapped.air_temp_f, 66.6);
    assert.equal(mapped.surface_temp_f, 75.4);
    assert.equal(mapped.surface_status, 'Wet');
    assert.equal(mapped.humidity, 70);
    assert.ok(mapped.wind_speed_mph != null && mapped.wind_speed_mph > 5);
  });

  it('parses weather station GeoJSON', () => {
    const station = parseWeatherStationFeature({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-106.9, 39.3] },
      properties: {
        id: 'ws1',
        publicName: 'Test RWIS',
        routeName: 'I-70',
        lastUpdated: '2026-07-22T01:00:00.000Z',
        sensors: [
          { type: 'temperature', currentReading: '10' },
          { type: 'road surface status', currentReading: '3' },
        ],
      },
    });
    assert.equal(station?.name, 'Test RWIS');
    assert.equal(station?.air_temp_f, 50);
    assert.equal(station?.surface_status, 'Dry');
  });

  it('parses incidents from MultiPoint geometry', () => {
    const incident = parseTravelerEventFeature(
      {
        type: 'Feature',
        geometry: { type: 'MultiPoint', coordinates: [[-104.7, 40.4]] },
        properties: {
          id: 'inc1',
          type: 'Maintenance Operations',
          routeName: 'US-34E',
          travelerInformationMessage: 'The left lane is closed near Greeley',
          severity: 'minor',
          lastUpdated: '2026-07-22T00:00:00.000Z',
          laneImpacts: [{ closedLaneTypes: ['left lane'] }],
        },
      },
      'incident',
    );
    assert.equal(incident?.lat, 40.4);
    assert.equal(incident?.closure, true);
    assert.match(String(incident?.description), /left lane is closed/);
  });

  it('parses road conditions without keeping LineString geometry', () => {
    const cond = parseRoadConditionFeature({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-108.0, 37.6],
          [-108.1, 37.7],
        ],
      },
      properties: {
        id: '151',
        name: 'Lizard Head Pass segment',
        nameId: 'Lizard Head Pass',
        routeName: 'CO 145',
        primaryLatitude: 37.682,
        primaryLongitude: -108.033,
        currentConditions: [
          {
            conditionDescription: '3 - dry',
            sourceType: 'OPERATOR',
            updateTime: 1_784_553_018_096,
            additionalData: null,
          },
          {
            conditionDescription: 'forecast text included',
            sourceType: 'NDFD',
            additionalData: 'Chance of Light Rain Showers.',
            updateTime: 1_784_680_243_266,
          },
        ],
      },
    });
    assert.equal(cond?.condition, 'dry');
    assert.match(String(cond?.forecast_text), /Light Rain/);
    assert.equal(cond?.lat, 37.682);
  });

  it('assigns nearby traveler events', () => {
    const events = [
      {
        id: 'near',
        title: 'Near',
        lat: 40.17,
        lon: -105.1,
        chain_law: false,
        closure: true,
        pass_relevant: false,
        source: 'incident',
      },
      {
        id: 'far',
        title: 'Far',
        lat: 39.0,
        lon: -108.5,
        chain_law: false,
        closure: false,
        pass_relevant: false,
        source: 'incident',
      },
    ];
    const assigned = assignEventsForLocation({ lat: 40.1672, lon: -105.1019 }, events);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].id, 'near');
  });

  it('prefers incidents over far-future planned events', () => {
    const now = Date.parse('2026-07-22T12:00:00Z');
    assert.equal(
      isRelevantTravelerEvent(
        {
          id: 'planned-far',
          source: 'planned',
          start_time: '2026-08-01T00:00:00Z',
        },
        now,
      ),
      false,
    );
    assert.equal(
      isRelevantTravelerEvent(
        {
          id: 'crash',
          source: 'incident',
        },
        now,
      ),
      true,
    );
  });
});

describe('fetchCotrip', () => {
  it('skips when API key is missing', async () => {
    const result = await fetchCotrip([{ slug: 'denver', lat: 39.74, lon: -104.99 }], {});
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.size, 0);
    assert.match(String(result.error), /COTRIP_API_KEY/);
  });
});

describe('rwisLiveReadings', () => {
  it('requires a fresh observation timestamp', () => {
    assert.equal(
      isRwisObservationFresh('2021-09-29T00:00:00Z', Date.parse('2026-07-22T00:00:00Z')),
      false,
    );
    const live = rwisLiveReadings(
      {
        air_temp_f: 70,
        surface_temp_f: 72,
        surface_status: 'Dry',
        observed: new Date().toISOString(),
      },
      Date.now(),
    );
    assert.equal(live.fresh, true);
    assert.equal(live.air_temp_f, 70);
  });
});
