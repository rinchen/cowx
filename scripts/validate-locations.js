#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCATIONS_PATH = path.join(__dirname, 'locations/colorado-locations.json');

const REQUIRED_FIELDS = ['slug', 'name', 'lat', 'lon', 'region', 'county', 'wfo', 'elevation_ft'];

/** Approximate Colorado bounding box (degrees). */
const CO_LAT_MIN = 36.9;
const CO_LAT_MAX = 41.1;
const CO_LON_MIN = -109.15;
const CO_LON_MAX = -102.0;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate location catalog data (pure; used by CLI and tests).
 * @param {unknown} data
 * @returns {string[]} error messages
 */
export function validateLocationsData(data) {
  const errors = [];

  if (!Array.isArray(data)) {
    return ['colorado-locations.json must be a JSON array of location objects'];
  }

  if (data.length === 0) {
    return ['colorado-locations.json must contain at least one location'];
  }

  const seenSlugs = new Set();

  for (let i = 0; i < data.length; i += 1) {
    const entry = data[i];
    const prefix = `locations[${i}]`;

    if (!isObject(entry)) {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) {
        errors.push(`${prefix}: missing required field "${field}"`);
      }
    }

    if ('slug' in entry) {
      if (typeof entry.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) {
        errors.push(`${prefix}: slug "${entry.slug}" must be lowercase kebab-case`);
      } else if (seenSlugs.has(entry.slug)) {
        errors.push(`${prefix}: duplicate slug "${entry.slug}"`);
      } else {
        seenSlugs.add(entry.slug);
      }
    }

    if ('lat' in entry) {
      if (typeof entry.lat !== 'number' || entry.lat < -90 || entry.lat > 90) {
        errors.push(`${prefix}: lat must be a number between -90 and 90`);
      } else if (entry.lat < CO_LAT_MIN || entry.lat > CO_LAT_MAX) {
        errors.push(`${prefix}: lat ${entry.lat} is outside Colorado bounds`);
      }
    }

    if ('lon' in entry) {
      if (typeof entry.lon !== 'number' || entry.lon < -180 || entry.lon > 180) {
        errors.push(`${prefix}: lon must be a number between -180 and 180`);
      } else if (entry.lon < CO_LON_MIN || entry.lon > CO_LON_MAX) {
        errors.push(`${prefix}: lon ${entry.lon} is outside Colorado bounds`);
      }
    }

    if ('elevation_ft' in entry && typeof entry.elevation_ft !== 'number') {
      errors.push(`${prefix}: elevation_ft must be a number`);
    }
  }

  return errors;
}

/**
 * Validate Colorado locations file structure.
 * @returns {Promise<number>} exit code
 */
export async function validateLocations() {
  let raw;
  try {
    raw = await readFile(LOCATIONS_PATH, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      console.error(`error: locations file not found at ${LOCATIONS_PATH}`);
      console.error(
        'Create scripts/locations/colorado-locations.json with required location entries.',
      );
      return 1;
    }
    console.error('error: failed to read locations file:', err);
    return 1;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('error: locations file is not valid JSON:', err);
    return 1;
  }

  const errors = validateLocationsData(data);

  if (errors.length > 0) {
    console.error('error: invalid colorado-locations.json:');
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    return 1;
  }

  console.log(`validate:locations ok (${data.length} location${data.length === 1 ? '' : 's'})`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  validateLocations()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('validate:locations failed:', err);
      process.exitCode = 1;
    });
}
