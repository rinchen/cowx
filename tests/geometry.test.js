import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pointInGeometry, pointInRing } from '../scripts/lib/geometry.js';

describe('pointInRing', () => {
  const square = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];

  it('detects points inside and outside a ring', () => {
    assert.equal(pointInRing(1, 1, square), true);
    assert.equal(pointInRing(3, 1, square), false);
  });

  it('rejects malformed rings', () => {
    assert.equal(pointInRing(1, 1, []), false);
    assert.equal(pointInRing(1, 1, [[1, 1]]), false);
    assert.equal(pointInRing(1, 1, [[1], [2, 2], [3, 3]]), false);
  });
});

describe('pointInGeometry', () => {
  it('handles Polygon with a hole', () => {
    const poly = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    };
    assert.equal(pointInGeometry(0.5, 0.5, poly), true);
    assert.equal(pointInGeometry(1.5, 1.5, poly), false);
  });

  it('handles MultiPolygon', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
            [5, 5],
          ],
        ],
      ],
    };
    assert.equal(pointInGeometry(0.5, 0.5, multi), true);
    assert.equal(pointInGeometry(5.5, 5.5, multi), true);
    assert.equal(pointInGeometry(3, 3, multi), false);
  });

  it('returns false for unsupported or empty geometry', () => {
    assert.equal(pointInGeometry(0, 0, null), false);
    assert.equal(pointInGeometry(0, 0, { type: 'Point', coordinates: [0, 0] }), false);
  });
});

describe('geometryRepresentativePoint', () => {
  it('handles Point, MultiPoint, and LineString midpoints', async () => {
    const { geometryRepresentativePoint } = await import('../scripts/lib/geometry.js');
    assert.deepEqual(geometryRepresentativePoint({ type: 'Point', coordinates: [-105, 39] }), {
      lat: 39,
      lon: -105,
    });
    assert.deepEqual(
      geometryRepresentativePoint({
        type: 'MultiPoint',
        coordinates: [
          [-105, 39],
          [-104, 40],
        ],
      }),
      { lat: 39, lon: -105 },
    );
    assert.deepEqual(
      geometryRepresentativePoint({
        type: 'LineString',
        coordinates: [
          [-105, 39],
          [-104.5, 39.5],
          [-104, 40],
        ],
      }),
      { lat: 39.5, lon: -104.5 },
    );
  });
});
