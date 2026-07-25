import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCbrfcEspJson, nearestCbrfcPoint } from '../scripts/fetch/adapters/cbrfc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CBRFC helpers', () => {
  it('parses ESP JSON and keeps Colorado points only', async () => {
    const raw = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/cbrfc-esp-sample.json'), 'utf8'),
    );
    const points = parseCbrfcEspJson(raw);
    assert.equal(points.length, 4);
    assert.ok(points.every((p) => p.id && Number.isFinite(p.lat) && Number.isFinite(p.lon)));
    // Fixture includes a WY point that must be filtered out
    assert.ok(!points.some((p) => String(p.id) === 'WBRW4'));
    assert.ok(points.some((p) => p.id === 'STMC2'));
  });

  it('ranks nearest point within max distance', async () => {
    const raw = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/cbrfc-esp-sample.json'), 'utf8'),
    );
    const points = parseCbrfcEspJson(raw);
    // Steamboat Springs area — STMC2 is in the fixture
    const hit = nearestCbrfcPoint({ lat: 40.48, lon: -106.83 }, points, 60);
    assert.ok(hit);
    assert.equal(hit.id, 'STMC2');
    assert.ok(hit.pctAvg != null);
    assert.match(String(hit.pointUrl), /espgraph_hc\.html\?id=STMC2/);
    assert.match(String(hit.disclaimer), /guidance/i);
  });

  it('returns null when nothing within range', async () => {
    const raw = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/cbrfc-esp-sample.json'), 'utf8'),
    );
    const points = parseCbrfcEspJson(raw);
    const hit = nearestCbrfcPoint({ lat: 40.5, lon: -102.5 }, points, 10);
    assert.equal(hit, null);
  });

  it('handles empty / invalid input', () => {
    assert.deepEqual(parseCbrfcEspJson(null), []);
    assert.deepEqual(parseCbrfcEspJson({}), []);
  });
});
