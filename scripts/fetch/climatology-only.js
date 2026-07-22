#!/usr/bin/env node
/**
 * Climatology-only backfill — merges ERA5 DOY normals into existing location payloads.
 * Does not re-run forecast/AQ/NWS adapters.
 *
 * Usage:
 *   pnpm run fetch:climatology
 *   CLIMATOLOGY_MAX_LOCS=40 pnpm run fetch:climatology
 *
 * maxLocs caps unique ERA5 ~0.25° cells (each cell may fill multiple catalog slugs).
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  climatologyIsFresh,
  era5CellKey,
  fetchOpenMeteoClimatology,
} from './adapters/openmeteo-climatology.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOCATIONS_PATH = path.join(ROOT, 'scripts/locations/colorado-locations.json');
const LOCATIONS_DIR = path.join(ROOT, 'public/data/locations');
const META_PATH = path.join(ROOT, 'public/data/meta.json');

/**
 * Copy fresh climatology to other catalog points in the same ERA5 cell (no API calls).
 * @param {import('../lib/types.js').Location[]} locations
 * @returns {Promise<number>}
 */
async function propagateSiblingCells(locations) {
  /** @type {Map<string, object>} */
  const donorByCell = new Map();
  for (const loc of locations) {
    try {
      const prior = JSON.parse(
        await readFile(path.join(LOCATIONS_DIR, `${loc.slug}.json`), 'utf8'),
      );
      if (!climatologyIsFresh(prior?.climatology)) continue;
      const key = era5CellKey(loc.lat, loc.lon);
      if (!donorByCell.has(key)) donorByCell.set(key, prior.climatology);
    } catch {
      /* missing payload */
    }
  }

  let written = 0;
  for (const loc of locations) {
    const key = era5CellKey(loc.lat, loc.lon);
    const donor = donorByCell.get(key);
    if (!donor) continue;
    const file = path.join(LOCATIONS_DIR, `${loc.slug}.json`);
    try {
      const payload = JSON.parse(await readFile(file, 'utf8'));
      if (climatologyIsFresh(payload?.climatology)) continue;
      payload.climatology = donor;
      await writeFile(file, JSON.stringify(payload), 'utf8');
      written += 1;
    } catch {
      /* skip */
    }
  }
  return written;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  /** @type {import('../lib/types.js').Location[]} */
  const locations = JSON.parse(await readFile(LOCATIONS_PATH, 'utf8'));

  const propagated = await propagateSiblingCells(locations);
  if (propagated) {
    console.log(
      `climatology-only: copied normals to ${propagated} locations from sibling ERA5 cells`,
    );
  }

  /** @type {import('../lib/types.js').Location[]} */
  const stale = [];
  for (const loc of locations) {
    try {
      const prior = JSON.parse(
        await readFile(path.join(LOCATIONS_DIR, `${loc.slug}.json`), 'utf8'),
      );
      if (!climatologyIsFresh(prior?.climatology)) stale.push(loc);
    } catch {
      stale.push(loc);
    }
  }

  const maxLocsEnv = process.env.CLIMATOLOGY_MAX_LOCS;
  const maxLocs =
    maxLocsEnv != null && maxLocsEnv !== '' ? Math.max(0, Number(maxLocsEnv) || 0) : stale.length;
  console.log(
    `climatology-only: ${stale.length}/${locations.length} need refresh; fetching up to ${maxLocs} ERA5 cells`,
  );

  if (!stale.length) {
    console.log('climatology-only: nothing to do');
    return;
  }

  if (maxLocs === 0) {
    console.log('climatology-only: CLIMATOLOGY_MAX_LOCS=0 — skip archive fetch');
    return;
  }
  const result = await fetchOpenMeteoClimatology(stale, { maxLocs });
  console.log(
    `climatology-only: status=${result.status} coverage=${result.bySlug.size} calls=${result.calls}`,
  );
  if (result.error) console.warn(`climatology-only: ${result.error}`);

  let written = 0;
  for (const [slug, climo] of result.bySlug) {
    const file = path.join(LOCATIONS_DIR, `${slug}.json`);
    const payload = JSON.parse(await readFile(file, 'utf8'));
    payload.climatology = climo;
    await writeFile(file, JSON.stringify(payload), 'utf8');
    written += 1;
  }
  console.log(`climatology-only: wrote ${written} location files`);

  try {
    const meta = JSON.parse(await readFile(META_PATH, 'utf8'));
    const sources = Array.isArray(meta.sources) ? meta.sources : [];
    const row = {
      id: 'openmeteo_climatology',
      status: result.status,
      fetchedAt: new Date().toISOString(),
      ...(result.error ? { error: String(result.error).slice(0, 500) } : {}),
    };
    const idx = sources.findIndex((s) => s && s.id === 'openmeteo_climatology');
    if (idx >= 0) sources[idx] = row;
    else sources.push(row);
    meta.sources = sources;
    meta.apiCalls = (meta.apiCalls ?? 0) + (result.calls ?? 0);
    await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn(
      `climatology-only: meta update failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (result.status === 'error' && written === 0 && propagated === 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('climatology-only failed:', err);
  process.exitCode = 1;
});
