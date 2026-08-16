#!/usr/bin/env node
/**
 * Rebuild scripts/locations/co-zips.json from GeoNames US postal codes (CC-BY).
 *
 * Usage:
 *   pnpm run build:co-zips
 *   GEONAMES_US_TXT=/path/to/US.txt pnpm run build:co-zips
 *   GEONAMES_US_ZIP=/path/to/US.zip pnpm run build:co-zips
 *
 * Downloads https://download.geonames.org/export/zip/US.zip when no local path is set.
 * Writes scripts/locations/co-zips.json and mirrors to public/data/co-zips.json.
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { fetchWithTimeout } from '../lib/http.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_SRC = path.join(__dirname, 'co-zips.json');
const OUT_PUBLIC = path.join(ROOT, 'public/data/co-zips.json');

const GEONAMES_US_ZIP_URL = 'https://download.geonames.org/export/zip/US.zip';

/** Same bbox as scripts/validate-locations.js */
const CO_LAT_MIN = 36.9;
const CO_LAT_MAX = 41.1;
const CO_LON_MIN = -109.15;
const CO_LON_MAX = -102.0;

/**
 * @param {string} text
 * @returns {{ zip: string; lat: number; lon: number; city: string; county: string }[]}
 */
export function parseGeoNamesUsText(text) {
  /** @type {Map<string, { zip: string; lat: number; lon: number; city: string; county: string; accuracy: number }>} */
  const byZip = new Map();

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 11) continue;

    const country = cols[0];
    const zip = cols[1];
    const city = cols[2]?.trim() ?? '';
    const adminCode1 = cols[4];
    const county = cols[5]?.trim() ?? '';
    const lat = Number(cols[9]);
    const lon = Number(cols[10]);
    const accuracy = Number(cols[11]);

    if (country !== 'US' || adminCode1 !== 'CO') continue;
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < CO_LAT_MIN || lat > CO_LAT_MAX || lon < CO_LON_MIN || lon > CO_LON_MAX) continue;

    const acc = Number.isFinite(accuracy) ? accuracy : 0;
    const prev = byZip.get(zip);
    if (prev && prev.accuracy >= acc) continue;

    byZip.set(zip, {
      zip,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      city,
      county,
      accuracy: acc,
    });
  }

  return [...byZip.values()]
    .sort((a, b) => a.zip.localeCompare(b.zip))
    .map(({ zip, lat, lon, city, county }) => ({ zip, lat, lon, city, county }));
}

/**
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {Promise<string>} path to US.txt
 */
async function unzipUsTxt(zipPath, destDir) {
  await execFileAsync('unzip', ['-o', '-q', zipPath, 'US.txt', '-d', destDir], {
    timeout: 60_000,
  });
  return path.join(destDir, 'US.txt');
}

/**
 * @returns {Promise<string>} GeoNames US.txt contents
 */
async function loadUsText() {
  const localTxt = process.env.GEONAMES_US_TXT?.trim();
  if (localTxt) {
    return readFile(path.resolve(localTxt), 'utf8');
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'cowx-geonames-'));
  try {
    const localZip = process.env.GEONAMES_US_ZIP?.trim();
    let zipPath;
    if (localZip) {
      zipPath = path.resolve(localZip);
    } else {
      console.log(`build:co-zips downloading ${GEONAMES_US_ZIP_URL}`);
      const res = await fetchWithTimeout(GEONAMES_US_ZIP_URL, { timeoutMs: 120_000 });
      if (!res.ok) {
        throw new Error(`GeoNames download failed: HTTP ${res.status}`);
      }
      zipPath = path.join(workDir, 'US.zip');
      await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    }

    const txtPath = await unzipUsTxt(zipPath, workDir);
    return readFile(txtPath, 'utf8');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @returns {Promise<{ count: number; outSrc: string; outPublic: string }>}
 */
export async function buildCoZips() {
  const text = await loadUsText();
  const rows = parseGeoNamesUsText(text);
  if (rows.length < 500) {
    throw new Error(`expected >= 500 Colorado ZIPs, got ${rows.length}`);
  }

  const json = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFile(OUT_SRC, json, 'utf8');
  await copyFile(OUT_SRC, OUT_PUBLIC);

  return { count: rows.length, outSrc: OUT_SRC, outPublic: OUT_PUBLIC };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  buildCoZips()
    .then(({ count, outSrc, outPublic }) => {
      console.log(`build:co-zips wrote ${count} ZIPs → ${path.relative(ROOT, outSrc)}`);
      console.log(`build:co-zips mirrored → ${path.relative(ROOT, outPublic)}`);
    })
    .catch((err) => {
      console.error('build:co-zips failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
