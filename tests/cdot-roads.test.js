import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignAlertsForLocation,
  assignCamerasForLocation,
  geometryMidpoint,
  parseAlertsGeoJson,
} from '../scripts/fetch/adapters/cdot.js';

describe('CDOT alerts parser', () => {
  it('parses alert points with chain/closure flags', () => {
    const raw = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-105.1, 40.1] },
          properties: {
            alertid: 'a1',
            title: 'I-70 Loveland Pass chain law',
            type: 'Road Condition',
            roadname: 'I-70',
            description: 'Chain law in effect both directions',
            impact: 'Major',
            roadwayclosure: 'No',
            startlatitude: 40.1,
            startlongitude: -105.1,
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-104.9, 39.7] },
          properties: {
            alertid: 'a2',
            title: 'US-285 closed',
            description: 'Roadway closure for incident',
            roadwayclosure: 'Yes',
            startlatitude: 39.7,
            startlongitude: -104.9,
          },
        },
      ],
    };
    const alerts = parseAlertsGeoJson(raw, 'point');
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].chain_law, true);
    assert.equal(alerts[0].pass_relevant, true);
    assert.equal(alerts[1].closure, true);
  });

  it('assigns nearest alerts within radius', () => {
    const alerts = parseAlertsGeoJson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-105.1, 40.17] },
            properties: {
              alertid: 'near',
              title: 'Local advisory',
              startlatitude: 40.17,
              startlongitude: -105.1,
            },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-108.5, 39.0] },
            properties: {
              alertid: 'far',
              title: 'Far west slope',
              startlatitude: 39.0,
              startlongitude: -108.5,
            },
          },
        ],
      },
      'point',
    );
    const assigned = assignAlertsForLocation({ lat: 40.1672, lon: -105.1019 }, alerts);
    assert.ok(assigned.some((a) => a.id === 'near'));
    assert.ok(!assigned.some((a) => a.id === 'far'));
  });

  it('computes polyline midpoint', () => {
    const mid = geometryMidpoint({
      type: 'LineString',
      coordinates: [
        [-105, 40],
        [-104, 40],
        [-103, 40],
      ],
    });
    assert.ok(mid);
    assert.equal(mid.lat, 40);
    assert.equal(mid.lon, -104);
  });
});

describe('CDOT multi-camera assign', () => {
  const cameras = [
    {
      id: '1',
      name: 'Near',
      lat: 40.17,
      lon: -105.1,
      imageUrl: 'https://example.com/a.jpg',
      pageUrl: 'https://maps.cotrip.org/',
    },
    {
      id: '2',
      name: 'Also near',
      lat: 40.2,
      lon: -105.05,
      imageUrl: 'https://example.com/b.jpg',
      pageUrl: 'https://maps.cotrip.org/',
    },
    {
      id: '3',
      name: 'Far',
      lat: 37.0,
      lon: -108.0,
      imageUrl: 'https://example.com/c.jpg',
      pageUrl: 'https://maps.cotrip.org/',
    },
  ];

  it('returns up to 3 within 40 km', () => {
    const list = assignCamerasForLocation({ lat: 40.1672, lon: -105.1019 }, cameras);
    assert.ok(list.length >= 1);
    assert.ok(list.length <= 3);
    assert.ok(list.every((c) => c.distance_km <= 40));
  });

  it('falls back to nearest statewide when none within 40 km', () => {
    const list = assignCamerasForLocation({ lat: 40.5, lon: -102.5 }, cameras);
    assert.equal(list.length, 1);
    assert.ok(list[0].distance_km > 40);
  });
});
