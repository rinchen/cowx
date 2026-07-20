import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  densityAtPoint,
  normalizeDensity,
  pointInRing,
  parseDbf,
  hmsSmokeZipUrl,
  MAX_HMS_ZIP_BYTES,
} from '../scripts/fetch/adapters/hms.js';

describe('HMS helpers', () => {
  it('normalizes density labels', () => {
    assert.equal(normalizeDensity('Light'), 'light');
    assert.equal(normalizeDensity('MEDIUM'), 'medium');
    assert.equal(normalizeDensity('Heavy Smoke'), 'heavy');
    assert.equal(normalizeDensity(''), 'none');
  });

  it('point-in-ring detects interior', () => {
    const square = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ];
    assert.equal(pointInRing(5, 5, square), true);
    assert.equal(pointInRing(15, 5, square), false);
  });

  it('densityAtPoint picks heaviest overlapping plume', () => {
    const polys = [
      {
        density: 'light',
        rings: [
          [
            [-106, 39],
            [-106, 41],
            [-104, 41],
            [-104, 39],
            [-106, 39],
          ],
        ],
      },
      {
        density: 'heavy',
        rings: [
          [
            [-105.5, 39.5],
            [-105.5, 40.5],
            [-104.5, 40.5],
            [-104.5, 39.5],
            [-105.5, 39.5],
          ],
        ],
      },
    ];
    assert.equal(densityAtPoint(-105, 40, polys), 'heavy');
    assert.equal(densityAtPoint(-108, 40, polys), 'none');
  });

  it('builds dated zip URL', () => {
    const url = hmsSmokeZipUrl(new Date(Date.UTC(2026, 6, 20)));
    assert.match(url, /hms_smoke20260720\.zip$/);
    assert.match(url, /\/2026\/07\//);
  });

  it('parseDbf returns empty for tiny buffer', () => {
    assert.deepEqual(parseDbf(Buffer.alloc(10)), []);
  });

  it('exports a modest max zip size (~50MB)', () => {
    assert.equal(MAX_HMS_ZIP_BYTES, 50 * 1024 * 1024);
  });
});
