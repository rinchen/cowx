import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetAlertPollingForTests,
  alertsForLocation,
  applyAlertResponse,
  buildAlertIndex,
  collapseAlertsForGlance,
  getAlertsForLocation,
  hasLiveAlerts,
  normalizeAlertFeature,
  pointInGeometry,
  pointInRing,
  resolveLocationAlerts,
} from '../public/js/nws-alerts.js';

const square = [
  [-105.1, 39.9],
  [-104.9, 39.9],
  [-104.9, 40.1],
  [-105.1, 40.1],
  [-105.1, 39.9],
];

describe('nws-alerts normalize + index', () => {
  it('normalizes raw NWS feature properties into COWX summary shape', () => {
    const { summary, geometry } = normalizeAlertFeature({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [square] },
      properties: {
        id: 'urn:oid:2.49.0.1.840.0.test',
        event: 'Tornado Warning',
        headline: 'Tornado Warning for Boulder',
        description: 'A tornado was spotted.',
        ends: '2026-07-28T20:00:00-06:00',
        severity: 'Extreme',
        areaDesc: 'Boulder; Jefferson',
      },
    });
    assert.equal(summary.event, 'Tornado Warning');
    assert.equal(summary.severity, 'Extreme');
    assert.equal(summary.id, 'urn:oid:2.49.0.1.840.0.test');
    assert.equal(summary.url, 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.test');
    assert.ok(geometry);
  });

  it('builds https alert URL from absolute @id', () => {
    const { summary } = normalizeAlertFeature({
      properties: {
        '@id': 'https://api.weather.gov/alerts/abc',
        event: 'Watch',
      },
    });
    assert.equal(summary.url, 'https://api.weather.gov/alerts/abc');
    assert.equal(summary.id, 'https://api.weather.gov/alerts/abc');
  });

  it('indexes counties from areaDesc and geometry features', () => {
    const { byCounty, alertsGeoJson } = buildAlertIndex([
      {
        geometry: { type: 'Polygon', coordinates: [square] },
        properties: {
          id: 'a1',
          event: 'Wind Advisory',
          areaDesc: 'Boulder County; Weld',
          ends: null,
          headline: 'Wind',
        },
      },
      {
        geometry: null,
        properties: {
          id: 'a2',
          event: 'Winter Weather Advisory',
          areaDesc: 'Denver',
          ends: null,
          headline: 'Snow',
        },
      },
    ]);
    assert.equal(byCounty.get('boulder')?.length, 1);
    assert.equal(byCounty.get('weld')?.length, 1);
    assert.equal(byCounty.get('denver')?.length, 1);
    assert.equal(alertsGeoJson.features.length, 1);
    assert.equal(alertsGeoJson.features[0].properties.id, 'a1');
  });

  it('indexes Denver, CO areaDesc and FIPS for zone watches without geometry', () => {
    const { byCounty } = buildAlertIndex([
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-104.93, 39.63],
              [-104.68, 39.63],
              [-104.68, 39.82],
              [-104.93, 39.82],
              [-104.93, 39.63],
            ],
          ],
        },
        properties: {
          id: 'ffw',
          event: 'Flash Flood Warning',
          areaDesc: 'Adams, CO; Western Arapahoe, CO; Denver, CO',
          severity: 'Severe',
          ends: null,
          headline: 'FFW',
          geocode: { SAME: ['008001', '008005', '008031'], UGC: ['COC001', 'COC005', 'COC031'] },
        },
      },
      {
        geometry: null,
        properties: {
          id: 'flood-watch',
          event: 'Flood Watch',
          areaDesc:
            'North Douglas County Below 6000 Feet/Denver/West Adams and Arapahoe Counties/East Broomfield County',
          severity: 'Severe',
          ends: null,
          headline: 'Flood Watch',
          geocode: {
            SAME: ['008031', '008001', '008005', '008035'],
            UGC: ['COZ041'],
          },
        },
      },
    ]);

    const denver = byCounty.get('denver') ?? [];
    assert.equal(denver.length, 2);
    assert.deepEqual(denver.map((a) => a.id).sort(), ['ffw', 'flood-watch']);

    // Catalog downtown Denver is west of the FFW polygon — county match still applies.
    const matched = alertsForLocation(39.7392, -104.9903, 'Denver', byCounty, {
      features: [],
    });
    assert.equal(matched.length, 2);
  });
});

describe('nws-alerts geometry matching', () => {
  it('detects point inside ring', () => {
    assert.equal(pointInRing(-105.0, 40.0, square), true);
    assert.equal(pointInRing(-106.0, 40.0, square), false);
  });

  it('handles polygon geometry', () => {
    assert.equal(pointInGeometry(-105.0, 40.0, { type: 'Polygon', coordinates: [square] }), true);
  });

  it('merges county and geometry alerts without duplicates', () => {
    const byCounty = new Map([
      ['boulder', [{ id: 'a1', event: 'Wind Advisory', ends: '2026-07-20', headline: 'Wind' }]],
    ]);
    const geo = {
      features: [
        {
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: {
            id: 'a2',
            event: 'Red Flag Warning',
            ends: '2026-07-20',
            headline: 'Fire',
          },
        },
        {
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: {
            id: 'a1',
            event: 'Wind Advisory',
            ends: '2026-07-20',
            headline: 'Wind',
          },
        },
      ],
    };
    const merged = alertsForLocation(40.0, -105.0, 'boulder', byCounty, geo);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((a) => a.id).sort(), ['a1', 'a2']);
  });
});

describe('nws-alerts live resolve', () => {
  beforeEach(() => {
    _resetAlertPollingForTests();
  });

  it('falls back to payload alerts until live data is ready', () => {
    const payload = {
      lat: 40.0,
      lon: -105.0,
      county: 'Boulder',
      alerts: [{ id: 'cached', event: 'Cached Alert' }],
    };
    assert.equal(hasLiveAlerts(), false);
    const alerts = resolveLocationAlerts(payload, null);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].id, 'cached');
  });

  it('prefers live alerts and uses pin coordinates for geometry', () => {
    applyAlertResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: {
            id: 'live-poly',
            event: 'Tornado Warning',
            headline: 'Tornado',
            description: '',
            ends: null,
            severity: 'Extreme',
            areaDesc: 'Weld',
          },
        },
      ],
    });
    assert.equal(hasLiveAlerts(), true);

    // Catalog point outside square, pin inside — pin should match.
    const data = {
      lat: 41.0,
      lon: -106.0,
      county: 'Larimer',
      alerts: [{ id: 'cached', event: 'Stale' }],
    };
    const withPin = resolveLocationAlerts(data, { lat: 40.0, lon: -105.0 });
    assert.equal(withPin.length, 1);
    assert.equal(withPin[0].id, 'live-poly');

    const catalogOnly = resolveLocationAlerts(data, null);
    assert.equal(catalogOnly.length, 0);

    assert.equal(getAlertsForLocation(40.0, -105.0, 'weld').length, 1);
  });

  it('applyAlertResponse reports unchanged when ids are stable', () => {
    const payload = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: null,
          properties: { id: 'x', event: 'Watch', areaDesc: 'Denver', headline: 'h' },
        },
      ],
    };
    assert.equal(applyAlertResponse(payload).changed, true);
    assert.equal(applyAlertResponse(payload).changed, false);
  });
});

describe('collapseAlertsForGlance', () => {
  it('collapses same event names and keeps the longest-ending advisory', () => {
    const collapsed = collapseAlertsForGlance([
      {
        id: 'a1',
        event: 'Flood Advisory',
        severity: 'Minor',
        ends: '2026-08-15T15:30:00-06:00',
      },
      {
        id: 'a2',
        event: 'Flood Advisory',
        severity: 'Minor',
        ends: '2026-08-15T16:30:00-06:00',
      },
      {
        id: 'w1',
        event: 'Flash Flood Warning',
        severity: 'Severe',
        ends: '2026-08-15T17:45:00-06:00',
      },
    ]);
    assert.equal(collapsed.length, 2);
    assert.equal(collapsed[0].alert.event, 'Flash Flood Warning');
    assert.equal(collapsed[1].alert.id, 'a2');
    assert.equal(collapsed[1].count, 2);
  });
});
