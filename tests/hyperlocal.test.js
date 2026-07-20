import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  _clearHyperlocalCache,
  featuresFromGeoJson,
  mapOpenMeteoCurrent,
  nearestFromPin,
} from '../public/js/hyperlocal.js';

afterEach(() => {
  _clearHyperlocalCache();
});

describe('featuresFromGeoJson', () => {
  it('extracts lat/lon and properties from Point features', () => {
    const pts = featuresFromGeoJson({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
          properties: { id: 'cam-1', name: 'I-25' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: 'bad' },
          properties: { id: 'skip' },
        },
      ],
    });
    assert.equal(pts.length, 1);
    assert.equal(pts[0].lat, 39.74);
    assert.equal(pts[0].lon, -104.99);
    assert.equal(pts[0].props.name, 'I-25');
  });

  it('returns empty for malformed input', () => {
    assert.deepEqual(featuresFromGeoJson(null), []);
    assert.deepEqual(featuresFromGeoJson({}), []);
  });
});

describe('nearestFromPin', () => {
  const pinLat = 39.74;
  const pinLon = -104.99;
  const candidates = [
    { lat: 40.02, lon: -105.27, item: { id: 'boulder' } },
    { lat: 39.75, lon: -104.98, item: { id: 'near' } },
    { lat: 38.83, lon: -104.82, item: { id: 'cos' } },
  ];

  it('sorts by distance and respects limit', () => {
    const nearest = nearestFromPin(pinLat, pinLon, candidates, 2, 500);
    assert.equal(nearest.length, 2);
    assert.equal(nearest[0].id, 'near');
    assert.ok(nearest[0].distance_km < nearest[1].distance_km);
  });

  it('filters beyond maxKm', () => {
    const nearest = nearestFromPin(pinLat, pinLon, candidates, 5, 5);
    assert.equal(nearest.length, 1);
    assert.equal(nearest[0].id, 'near');
  });

  it('returns empty for bad pin', () => {
    assert.deepEqual(nearestFromPin(NaN, pinLon, candidates, 3, 50), []);
  });
});

describe('mapOpenMeteoCurrent', () => {
  it('maps imperial current fields', () => {
    const mapped = mapOpenMeteoCurrent({
      current: {
        temperature_2m: 72.4,
        apparent_temperature: 70.1,
        relative_humidity_2m: 33,
        weather_code: 1,
        wind_speed_10m: 8.2,
        wind_direction_10m: 270,
        wind_gusts_10m: 14,
        uv_index: 6,
        is_day: 1,
        time: '2026-07-20T16:00',
      },
    });
    assert.ok(mapped);
    assert.equal(mapped.temp_f, 72.4);
    assert.equal(mapped.humidity, 33);
    assert.equal(mapped.weather_code, 1);
    assert.equal(mapped.condition, 'Mostly Clear');
    assert.equal(mapped.wind_speed_mph, 8.2);
    assert.equal(mapped.is_day, 1);
  });

  it('returns null for missing current block', () => {
    assert.equal(mapOpenMeteoCurrent({}), null);
    assert.equal(mapOpenMeteoCurrent(null), null);
  });
});
