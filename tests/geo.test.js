import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assignNearestWithin,
  haversineKm,
  nearestPoint,
  nearestPoints,
  roundKm,
} from '../scripts/lib/geo.js';

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    const point = { lat: 39.7392, lon: -104.9903 };
    assert.ok(haversineKm(point, point) < 0.001);
  });

  it('computes a plausible Denver to Boulder distance', () => {
    const denver = { lat: 39.7392, lon: -104.9903 };
    const boulder = { lat: 40.015, lon: -105.2705 };
    const km = haversineKm(denver, boulder);
    assert.ok(km > 35 && km < 45);
  });
});

describe('nearestPoint', () => {
  const target = { lat: 39.7392, lon: -104.9903 };
  const candidates = [
    { slug: 'boulder', lat: 40.015, lon: -105.2705 },
    { slug: 'denver', lat: 39.7392, lon: -104.9903 },
    { slug: 'colorado-springs', lat: 38.8339, lon: -104.8214 },
  ];

  it('returns the closest candidate', () => {
    const result = nearestPoint(target, candidates);
    assert.ok(result);
    assert.equal(result.point.slug, 'denver');
    assert.ok(result.distanceKm < 1);
  });

  it('returns null for empty candidates', () => {
    assert.equal(nearestPoint(target, []), null);
  });
});

describe('nearestPoints / assignNearestWithin / roundKm', () => {
  const locations = [
    { slug: 'denver', lat: 39.7392, lon: -104.9903 },
    { slug: 'boulder', lat: 40.015, lon: -105.2705 },
  ];
  const candidates = [
    { id: 'a', lat: 39.74, lon: -104.99 },
    { id: 'b', lat: 40.02, lon: -105.27 },
    { id: 'far', lat: 38.0, lon: -102.0 },
  ];

  it('returns sorted nearestPoints capped by limit', () => {
    const hits = nearestPoints(locations[0], candidates, 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].point.id, 'a');
    assert.ok(hits[0].distanceKm <= hits[1].distanceKm);
  });

  it('assignNearestWithin respects maxKm and mapFn', () => {
    const bySlug = assignNearestWithin(locations, candidates, 5, (nearest) => ({
      id: nearest.point.id,
      distance_km: roundKm(nearest.distanceKm),
    }));
    assert.equal(bySlug.get('denver')?.id, 'a');
    assert.equal(bySlug.get('boulder')?.id, 'b');
    assert.equal(roundKm(1.26), 1.3);
  });
});
