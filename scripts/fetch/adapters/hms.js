/**
 * NOAA HMS smoke polygons — density at each Colorado location.
 * Failure point: shapefile zip missing / unzip / parse failure.
 * Fallback: status error/skipped; hms_smoke null; empty geojson.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchWithTimeout } from '../../lib/http.js';

const execFileAsync = promisify(execFile);

const CO_BBOX = { west: -109.2, south: 36.9, east: -102.0, north: 41.1 };

/**
 * @param {Date} day
 * @returns {string}
 */
function ymd(day) {
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * @param {Date} day
 * @returns {string}
 */
export function hmsSmokeZipUrl(day) {
  const stamp = ymd(day);
  const y = stamp.slice(0, 4);
  const m = stamp.slice(4, 6);
  return `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/${y}/${m}/hms_smoke${stamp}.zip`;
}

/**
 * Normalize density label.
 * @param {unknown} raw
 * @returns {'light' | 'medium' | 'heavy' | 'none'}
 */
export function normalizeDensity(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'none';
  if (s.includes('heavy') || s === 'h' || s === '3') return 'heavy';
  if (s.includes('medium') || s === 'm' || s === '2') return 'medium';
  if (s.includes('light') || s === 'l' || s === '1') return 'light';
  return 'none';
}

/**
 * Point-in-polygon (ray casting). Ring is [[lon,lat],...].
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring
 */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {{ density: string, rings: number[][][] }[]} polygons
 * @returns {'none' | 'light' | 'medium' | 'heavy'}
 */
export function densityAtPoint(lon, lat, polygons) {
  const rank = { none: 0, light: 1, medium: 2, heavy: 3 };
  let best = 'none';
  for (const poly of polygons) {
    for (const ring of poly.rings) {
      if (ring.length < 3) continue;
      if (pointInRing(lon, lat, ring)) {
        const d = /** @type {'none'|'light'|'medium'|'heavy'} */ (poly.density);
        if (rank[d] > rank[best]) best = d;
      }
    }
  }
  return /** @type {'none'|'light'|'medium'|'heavy'} */ (best);
}

/**
 * Minimal DBF reader (string/number fields).
 * @param {Buffer} buf
 * @returns {Record<string, unknown>[]}
 */
export function parseDbf(buf) {
  if (buf.length < 32) return [];
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  /** @type {{ name: string, type: string, length: number, offset: number }[]} */
  const fields = [];
  let offset = 32;
  while (offset < headerLen - 1 && buf[offset] !== 0x0d) {
    const name = buf
      .subarray(offset, offset + 11)
      .toString('ascii')
      .replace(/\0.*$/, '')
      .trim();
    const type = String.fromCharCode(buf[offset + 11]);
    const length = buf[offset + 16];
    fields.push({
      name,
      type,
      length,
      offset: fields.reduce((s, f) => s + f.length, 1),
    });
    offset += 32;
  }
  const records = [];
  let pos = headerLen;
  while (pos + recLen <= buf.length) {
    if (buf[pos] === 0x1a) break;
    if (buf[pos] === 0x2a) {
      pos += recLen;
      continue;
    }
    /** @type {Record<string, unknown>} */
    const row = {};
    for (const f of fields) {
      const raw = buf
        .subarray(pos + f.offset, pos + f.offset + f.length)
        .toString('ascii')
        .trim();
      row[f.name] = raw;
    }
    records.push(row);
    pos += recLen;
  }
  return records;
}

/**
 * Minimal shapefile polygon reader (assumes geographic WGS84 / already projected coords as lon/lat).
 * HMS smoke shapefiles are typically geographic.
 * @param {Buffer} buf
 * @returns {number[][][][]} polygons — each polygon is rings of [lon,lat]
 */
export function parseShpPolygons(buf) {
  if (buf.length < 100) return [];
  const out = [];
  let pos = 100;
  while (pos + 8 <= buf.length) {
    // record header: number (BE) + content length words (BE)
    const contentLenWords = buf.readInt32BE(pos + 4);
    const contentLen = contentLenWords * 2;
    pos += 8;
    if (pos + contentLen > buf.length) break;
    const shapeType = buf.readInt32LE(pos);
    if (shapeType === 0) {
      pos += contentLen;
      continue;
    }
    // Polygon = 5, PolygonZ = 15, PolygonM = 25
    if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
      pos += contentLen;
      continue;
    }
    const numParts = buf.readInt32LE(pos + 36);
    const numPoints = buf.readInt32LE(pos + 40);
    const partsStart = pos + 44;
    const pointsStart = partsStart + numParts * 4;
    /** @type {number[]} */
    const parts = [];
    for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(partsStart + i * 4));
    /** @type {number[][]} */
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const lon = buf.readDoubleLE(pointsStart + i * 16);
      const lat = buf.readDoubleLE(pointsStart + i * 16 + 8);
      points.push([lon, lat]);
    }
    /** @type {number[][][]} */
    const rings = [];
    for (let i = 0; i < parts.length; i++) {
      const start = parts[i];
      const end = i + 1 < parts.length ? parts[i + 1] : numPoints;
      rings.push(points.slice(start, end));
    }
    out.push(rings);
    pos += contentLen;
  }
  return out;
}

/**
 * Combine DBF + SHP into density polygons; keep those intersecting CO bbox loosely.
 * @param {Buffer} shpBuf
 * @param {Buffer} dbfBuf
 */
export function mergeHmsSmoke(shpBuf, dbfBuf) {
  const records = parseDbf(dbfBuf);
  const shapes = parseShpPolygons(shpBuf);
  /** @type {{ density: string, rings: number[][][] }[]} */
  const polygons = [];
  const n = Math.min(records.length, shapes.length);
  for (let i = 0; i < n; i++) {
    const rec = records[i];
    const density = normalizeDensity(
      rec.Density ?? rec.DENSITY ?? rec.density ?? rec.Smoke ?? rec.Category,
    );
    if (density === 'none') continue;
    const rings = shapes[i];
    // Keep if any vertex in/near CO
    let touchesCo = false;
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (
          lon >= CO_BBOX.west - 2 &&
          lon <= CO_BBOX.east + 2 &&
          lat >= CO_BBOX.south - 2 &&
          lat <= CO_BBOX.north + 2
        ) {
          touchesCo = true;
          break;
        }
      }
      if (touchesCo) break;
    }
    if (!touchesCo) continue;
    polygons.push({ density, rings });
  }
  return polygons;
}

/**
 * Slim GeoJSON for map (outer rings only, CO-ish).
 * @param {{ density: string, rings: number[][][] }[]} polygons
 */
export function polygonsToGeoJson(polygons) {
  return {
    type: 'FeatureCollection',
    features: polygons.map((p) => ({
      type: 'Feature',
      properties: { density: p.density },
      geometry: {
        type: 'Polygon',
        coordinates: p.rings,
      },
    })),
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchHms(locations) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;
  let smokeGeoJson = { type: 'FeatureCollection', features: [] };
  const errors = [];

  let dir = '';
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'cowx-hms-'));
    let zipBuf = null;
    let usedDay = null;
    const now = new Date();

    for (let back = 0; back <= 2; back++) {
      const day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back),
      );
      const url = hmsSmokeZipUrl(day);
      try {
        const res = await fetchWithTimeout(url, { timeoutMs: 90_000 });
        calls += 1;
        if (!res.ok) {
          errors.push(`${ymd(day)}: HTTP ${res.status}`);
          continue;
        }
        zipBuf = Buffer.from(await res.arrayBuffer());
        if (zipBuf.length < 100) {
          errors.push(`${ymd(day)}: empty zip`);
          zipBuf = null;
          continue;
        }
        usedDay = day;
        break;
      } catch (err) {
        calls += 1;
        errors.push(`${ymd(day)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!zipBuf || !usedDay) {
      for (const loc of locations) bySlug.set(loc.slug, null);
      return {
        status: 'error',
        bySlug,
        smokeGeoJson,
        calls,
        error: (errors.join('; ') || 'HMS smoke zip unavailable').slice(0, 500),
      };
    }

    const zipPath = path.join(dir, 'hms.zip');
    await writeFile(zipPath, zipBuf);
    try {
      await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', dir], { timeout: 60_000 });
    } catch (err) {
      for (const loc of locations) bySlug.set(loc.slug, null);
      return {
        status: 'error',
        bySlug,
        smokeGeoJson,
        calls,
        error: `unzip failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      };
    }

    const files = await readdir(dir);
    const shpName = files.find((f) => f.toLowerCase().endsWith('.shp'));
    const dbfName = files.find((f) => f.toLowerCase().endsWith('.dbf'));
    if (!shpName || !dbfName) {
      for (const loc of locations) bySlug.set(loc.slug, null);
      return {
        status: 'error',
        bySlug,
        smokeGeoJson,
        calls,
        error: 'HMS zip missing .shp/.dbf',
      };
    }

    const shpBuf = await readFile(path.join(dir, shpName));
    const dbfBuf = await readFile(path.join(dir, dbfName));
    const polygons = mergeHmsSmoke(shpBuf, dbfBuf);
    smokeGeoJson = polygonsToGeoJson(polygons);

    const observed = usedDay.toISOString().slice(0, 10);
    const sourceUrl = hmsSmokeZipUrl(usedDay);

    for (const loc of locations) {
      const density = densityAtPoint(loc.lon, loc.lat, polygons);
      bySlug.set(loc.slug, {
        density,
        observed,
        sourceUrl,
      });
    }

    const anySmoke = [...bySlug.values()].some((v) => v && v.density && v.density !== 'none');

    return {
      status: polygons.length === 0 ? 'partial' : anySmoke ? 'ok' : 'ok',
      bySlug,
      smokeGeoJson,
      calls,
      ...(polygons.length === 0 ? { error: 'no HMS polygons near Colorado' } : {}),
    };
  } catch (err) {
    for (const loc of locations) bySlug.set(loc.slug, null);
    return {
      status: 'error',
      bySlug,
      smokeGeoJson,
      calls,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  } finally {
    if (dir) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
