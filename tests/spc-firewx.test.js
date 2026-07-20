import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeWindRh,
  normalizeDryT,
  windRhAtPoint,
  dryTAtPoint,
  geometryTouchesColorado,
  clipSpcToColorado,
} from '../scripts/fetch/adapters/spc-firewx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

describe('SPC fire weather helpers', () => {
  it('normalizes Wind/RH from DN and LABEL', () => {
    assert.equal(normalizeWindRh(10, 'Extreme'), 'extreme');
    assert.equal(normalizeWindRh(8, 'Critical'), 'critical');
    assert.equal(normalizeWindRh(5, 'Elevated'), 'elevated');
    assert.equal(normalizeWindRh(0, 'No Areas'), 'none');
    assert.equal(normalizeWindRh(8, ''), 'critical');
  });

  it('normalizes DryT from DN and LABEL', () => {
    assert.equal(normalizeDryT(8, 'Scattered Dry T'), 'scattered');
    assert.equal(normalizeDryT(5, 'Isolated Dry T'), 'isolated');
    assert.equal(normalizeDryT(0, 'No Areas'), 'none');
  });

  it('returns none for empty No Areas GeoJSON', async () => {
    const empty = JSON.parse(
      await readFile(path.join(fixtures, 'spc-firewx-empty.geojson'), 'utf8'),
    );
    const hit = windRhAtPoint(-105, 40, empty);
    assert.equal(hit.risk, 'none');
    assert.equal(hit.valid, '2026-07-20T17:00:00+00:00');
  });

  it('picks highest Wind/RH risk at a point', async () => {
    const fc = JSON.parse(await readFile(path.join(fixtures, 'spc-firewx-windrh.geojson'), 'utf8'));
    // Inside critical polygon
    assert.equal(windRhAtPoint(-105.5, 39.75, fc).risk, 'critical');
    // Outside both
    assert.equal(windRhAtPoint(-109, 40, fc).risk, 'none');
  });

  it('detects DryT at a point', async () => {
    const fc = JSON.parse(await readFile(path.join(fixtures, 'spc-firewx-dryt.geojson'), 'utf8'));
    assert.equal(dryTAtPoint(-107, 37.8, fc), 'isolated');
    assert.equal(dryTAtPoint(-105, 40, fc), 'none');
  });

  it('clips features that touch Colorado', async () => {
    const windrh = JSON.parse(
      await readFile(path.join(fixtures, 'spc-firewx-windrh.geojson'), 'utf8'),
    );
    assert.equal(geometryTouchesColorado(windrh.features[0].geometry), true);
    const clipped = clipSpcToColorado({ day1_windrh: windrh });
    assert.equal(clipped.features.length, 2);
    assert.equal(clipped.features[0].properties.product, 'day1_windrh');
  });
});
