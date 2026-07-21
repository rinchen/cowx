import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alertsForLocation, pointInGeometry, pointInRing } from '../scripts/fetch/adapters/nws.js';

describe('nws geometry alerts', () => {
  const square = [
    [-105.1, 39.9],
    [-104.9, 39.9],
    [-104.9, 40.1],
    [-105.1, 40.1],
    [-105.1, 39.9],
  ];

  it('detects point inside ring', () => {
    assert.equal(pointInRing(-105.0, 40.0, square), true);
    assert.equal(pointInRing(-106.0, 40.0, square), false);
  });

  it('skips null or non-finite ring vertices without throwing', () => {
    const dirty = [
      null,
      [-105.1, 39.9],
      [undefined, 40],
      [-104.9, 39.9],
      [-104.9, 40.1],
      [-105.1, 40.1],
      [-105.1, 39.9],
    ];
    assert.equal(pointInRing(-105.0, 40.0, /** @type {any} */ (dirty)), true);
    assert.equal(pointInRing(-106.0, 40.0, /** @type {any} */ (dirty)), false);
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
    assert.ok(merged.some((a) => a.id === 'a2'));
  });
});
