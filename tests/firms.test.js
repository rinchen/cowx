import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFirmsCsv,
  nearestHotspots,
  hotspotsToGeoJson,
  redactFirmsUrl,
  fetchFirms,
} from '../scripts/fetch/adapters/firms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('FIRMS helpers', () => {
  it('parses VIIRS area CSV', async () => {
    const csv = await readFile(path.join(__dirname, 'fixtures/firms-viirs-sample.csv'), 'utf8');
    const hotspots = parseFirmsCsv(csv);
    assert.equal(hotspots.length, 4);
    assert.equal(hotspots[0].lat, 39.75);
    assert.equal(hotspots[0].lon, -105);
    assert.equal(hotspots[0].frp, 12.5);
    assert.equal(hotspots[0].confidence, 'nominal');
    assert.equal(hotspots[0].observed, '2026-07-25T18:30:00Z');
  });

  it('returns empty for invalid key / error bodies', () => {
    assert.deepEqual(parseFirmsCsv('Invalid MAP_KEY.'), []);
    assert.deepEqual(parseFirmsCsv(''), []);
  });

  it('ranks by distance and caps within 80 km', async () => {
    const csv = await readFile(path.join(__dirname, 'fixtures/firms-viirs-sample.csv'), 'utf8');
    const hotspots = parseFirmsCsv(csv);
    const near = nearestHotspots({ lat: 39.74, lon: -104.99 }, hotspots, 80, 3);
    assert.ok(near.length >= 2);
    assert.ok(near[0].distance_km <= near[1].distance_km);
    assert.ok(near.every((h) => h.distance_km <= 80));
    assert.ok(!near.some((h) => h.lon === -108.8));
  });

  it('builds GeoJSON features', async () => {
    const csv = await readFile(path.join(__dirname, 'fixtures/firms-viirs-sample.csv'), 'utf8');
    const fc = hotspotsToGeoJson(parseFirmsCsv(csv));
    assert.equal(fc.type, 'FeatureCollection');
    assert.equal(fc.features.length, 4);
    assert.equal(fc.features[0].geometry.type, 'Point');
  });

  it('redacts MAP_KEY from URLs', () => {
    const key = 'abc123secret';
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/-109,37,-102,41/1`;
    assert.ok(!redactFirmsUrl(url, key).includes(key));
    assert.match(redactFirmsUrl(url, key), /\[redacted\]/);
  });

  it('skips when FIRMS_MAP_KEY unset', async () => {
    const result = await fetchFirms([{ slug: 'denver', lat: 39.74, lon: -104.99 }], {});
    assert.equal(result.status, 'skipped');
    assert.equal(result.bySlug.get('denver'), null);
    assert.equal(result.firmsGeoJson.features.length, 0);
  });
});
