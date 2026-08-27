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

/** Matches schemas/location.schema.json region enum. */
const REGION_ENUM = new Set([
  'front-range',
  'mountains',
  'western-slope',
  'eastern-plains',
  'southwest',
  'northwest',
]);

/** Matches schemas/location.schema.json wfo enum. */
const WFO_ENUM = new Set(['BOU', 'PUB', 'GJT']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimum Colorado ZIP rows (full GeoNames rebuild is ~600+). */
export const MIN_CO_ZIPS = 500;

/**
 * Validate ZIP lookup table used for search + pollen links.
 * @param {unknown} data
 * @returns {string[]}
 */
export function validateCoZipsData(data) {
  const errors = [];
  if (!Array.isArray(data)) {
    return ['co-zips.json must be a JSON array'];
  }
  if (data.length === 0) {
    return ['co-zips.json must not be empty'];
  }
  if (data.length < MIN_CO_ZIPS) {
    errors.push(`co-zips.json must have at least ${MIN_CO_ZIPS} ZIPs (got ${data.length})`);
  }
  const seen = new Set();
  for (let i = 0; i < data.length; i += 1) {
    const row = data[i];
    if (!isObject(row)) {
      errors.push(`co-zips[${i}] must be an object`);
      continue;
    }
    const zip = row.zip;
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip)) {
      errors.push(`co-zips[${i}].zip must be a 5-digit string`);
    } else if (seen.has(zip)) {
      errors.push(`co-zips duplicate zip ${zip}`);
    } else {
      seen.add(zip);
    }
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || lat < CO_LAT_MIN || lat > CO_LAT_MAX) {
      errors.push(`co-zips[${i}].lat out of Colorado bounds`);
    }
    if (!Number.isFinite(lon) || lon < CO_LON_MIN || lon > CO_LON_MAX) {
      errors.push(`co-zips[${i}].lon out of Colorado bounds`);
    }
  }
  return errors;
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

  /** Soft cap so a runaway catalog cannot burn the full free-tier API budget. */
  const MAX_LOCATIONS = 1000;
  if (data.length > MAX_LOCATIONS) {
    return [`colorado-locations.json has ${data.length} locations (max ${MAX_LOCATIONS})`];
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

    if ('name' in entry) {
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        errors.push(`${prefix}: name must be a non-empty string`);
      }
    }

    if ('county' in entry) {
      if (typeof entry.county !== 'string' || !entry.county.trim()) {
        errors.push(`${prefix}: county must be a non-empty string`);
      }
    }

    if ('region' in entry) {
      if (typeof entry.region !== 'string' || !REGION_ENUM.has(entry.region)) {
        errors.push(
          `${prefix}: region must be one of ${[...REGION_ENUM].join(', ')} (got "${entry.region}")`,
        );
      }
    }

    if ('wfo' in entry) {
      if (typeof entry.wfo !== 'string' || !WFO_ENUM.has(entry.wfo)) {
        errors.push(`${prefix}: wfo must be one of BOU, PUB, GJT (got "${entry.wfo}")`);
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

    if ('elevation_ft' in entry) {
      if (typeof entry.elevation_ft !== 'number' || !Number.isFinite(entry.elevation_ft)) {
        errors.push(`${prefix}: elevation_ft must be a finite number`);
      } else if (entry.elevation_ft < 0) {
        errors.push(`${prefix}: elevation_ft must be >= 0`);
      }
    }

    if ('webcam_links' in entry && entry.webcam_links != null) {
      if (!Array.isArray(entry.webcam_links)) {
        errors.push(`${prefix}: webcam_links must be an array or null`);
      } else {
        for (let j = 0; j < entry.webcam_links.length; j += 1) {
          const link = entry.webcam_links[j];
          const lp = `${prefix}.webcam_links[${j}]`;
          if (!isObject(link)) {
            errors.push(`${lp}: must be an object`);
            continue;
          }
          if (typeof link.name !== 'string' || !link.name.trim()) {
            errors.push(`${lp}: name must be a non-empty string`);
          }
          if (typeof link.url !== 'string' || !/^https:\/\//.test(link.url)) {
            errors.push(`${lp}: url must be an https:// URL`);
          }
          if (
            'kind' in link &&
            link.kind != null &&
            !['city', 'county', 'nws', 'ski', 'other'].includes(String(link.kind))
          ) {
            errors.push(`${lp}: kind must be city|county|nws|ski|other`);
          }
        }
      }
    }

    if ('snow_report_links' in entry && entry.snow_report_links != null) {
      if (!Array.isArray(entry.snow_report_links)) {
        errors.push(`${prefix}: snow_report_links must be an array or null`);
      } else {
        for (let j = 0; j < entry.snow_report_links.length; j += 1) {
          const link = entry.snow_report_links[j];
          const lp = `${prefix}.snow_report_links[${j}]`;
          if (!isObject(link)) {
            errors.push(`${lp}: must be an object`);
            continue;
          }
          if (typeof link.name !== 'string' || !link.name.trim()) {
            errors.push(`${lp}: name must be a non-empty string`);
          }
          if (typeof link.url !== 'string' || !/^https:\/\//.test(link.url)) {
            errors.push(`${lp}: url must be an https:// URL`);
          }
        }
      }
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

  const zipsPath = path.join(__dirname, 'locations/co-zips.json');
  try {
    const zipsRaw = await readFile(zipsPath, 'utf8');
    const zips = JSON.parse(zipsRaw);
    const zipErrors = validateCoZipsData(zips);
    if (zipErrors.length) {
      console.error('error: invalid co-zips.json:');
      for (const message of zipErrors.slice(0, 30)) console.error(`  - ${message}`);
      return 1;
    }
    console.log(`validate:co-zips ok (${zips.length} ZIP${zips.length === 1 ? '' : 's'})`);
  } catch (err) {
    console.error('error: failed to validate co-zips.json:', err);
    return 1;
  }

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
