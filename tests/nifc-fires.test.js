import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNifcIncidents, nearestIncidents } from '../scripts/fetch/adapters/nifc-fires.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('NIFC fires helpers', () => {
  it('parses WFIGS GeoJSON incidents', async () => {
    const fc = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/nifc-fires.geojson'), 'utf8'),
    );
    const incidents = parseNifcIncidents(fc);
    assert.equal(incidents.length, 5);
    assert.equal(incidents[0].name, 'Near Denver Test');
    assert.equal(incidents[0].acres, 120);
    assert.equal(incidents[0].percentContained, 50);
  });

  it('ranks by distance and caps at 3 within 80 km', async () => {
    const fc = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/nifc-fires.geojson'), 'utf8'),
    );
    const incidents = parseNifcIncidents(fc);
    const near = nearestIncidents({ lat: 39.74, lon: -104.99 }, incidents, 80, 3);
    assert.equal(near.length, 3);
    assert.equal(near[0].name, 'Closer Front Range');
    assert.ok(near[0].distance_km <= near[1].distance_km);
    assert.ok(near.every((i) => i.distance_km <= 80));
    assert.ok(!near.some((i) => i.name === 'Far SW Fire'));
  });

  it('returns empty when nothing within range', async () => {
    const fc = JSON.parse(
      await readFile(path.join(__dirname, 'fixtures/nifc-fires.geojson'), 'utf8'),
    );
    const incidents = parseNifcIncidents(fc);
    const near = nearestIncidents({ lat: 40.5, lon: -102.5 }, incidents, 10, 3);
    assert.equal(near.length, 0);
  });
});
