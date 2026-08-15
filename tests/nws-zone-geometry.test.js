import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  _clearZoneGeometryCacheForTests,
  collectColoradoZoneRefs,
  geometryForAlertFeature,
  hydrateAlertGeometries,
  mergeZoneGeometries,
  ugcToZoneRef,
} from '../public/js/nws-zone-geometry.js';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [-105.1, 39.9],
      [-104.9, 39.9],
      [-104.9, 40.1],
      [-105.1, 40.1],
      [-105.1, 39.9],
    ],
  ],
};

const square2 = {
  type: 'Polygon',
  coordinates: [
    [
      [-104.9, 39.9],
      [-104.7, 39.9],
      [-104.7, 40.1],
      [-104.9, 40.1],
      [-104.9, 39.9],
    ],
  ],
};

describe('nws-zone-geometry', () => {
  beforeEach(() => {
    _clearZoneGeometryCacheForTests();
  });

  it('maps COZ/COC UGC to zone refs and ignores out-of-state', () => {
    assert.deepEqual(ugcToZoneRef('COZ041'), { type: 'forecast', id: 'COZ041' });
    assert.deepEqual(ugcToZoneRef('coc031'), { type: 'county', id: 'COC031' });
    assert.equal(ugcToZoneRef('KSZ027'), null);
  });

  it('collects zones only for alerts missing geometry', () => {
    const refs = collectColoradoZoneRefs([
      {
        geometry: square,
        properties: { geocode: { UGC: ['COZ041'] } },
      },
      {
        geometry: null,
        properties: { geocode: { UGC: ['COZ041', 'COZ042', 'KSZ027'] } },
      },
    ]);
    assert.deepEqual(refs.map((r) => r.id).sort(), ['COZ041', 'COZ042']);
  });

  it('merges polygons into a MultiPolygon', () => {
    const merged = mergeZoneGeometries([square, square2]);
    assert.ok(merged);
    assert.equal(merged.type, 'MultiPolygon');
    assert.equal(/** @type {unknown[]} */ (merged.coordinates).length, 2);
  });

  it('hydrates Flood Watch features from zone fetches', async () => {
    const features = [
      {
        type: 'Feature',
        geometry: null,
        properties: {
          id: 'watch-1',
          event: 'Flood Watch',
          geocode: { UGC: ['COZ041', 'COZ042'] },
        },
      },
    ];
    const urls = [];
    const hydrated = await hydrateAlertGeometries(features, {
      fetchZoneJson: async (url) => {
        urls.push(url);
        if (url.endsWith('COZ041')) return { geometry: square };
        if (url.endsWith('COZ042')) return { geometry: square2 };
        return { geometry: null };
      },
    });
    assert.equal(hydrated[0].geometry?.type, 'MultiPolygon');
    assert.deepEqual(urls.sort(), [
      'https://api.weather.gov/zones/forecast/COZ041',
      'https://api.weather.gov/zones/forecast/COZ042',
    ]);
    assert.equal(
      geometryForAlertFeature(
        features[0],
        new Map([
          ['forecast/COZ041', square],
          ['forecast/COZ042', square2],
        ]),
      )?.type,
      'MultiPolygon',
    );
  });
});
