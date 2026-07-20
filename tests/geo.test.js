import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { haversineKm, nearestPoint } from '../scripts/lib/geo.js';

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
