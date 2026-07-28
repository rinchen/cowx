#!/usr/bin/env node
/**
 * Validate catalog + sample public/data artifacts against schemas/ with Ajv.
 */

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020Module = require('ajv/dist/2020.js');
/** @type {typeof import('ajv').default} */
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const addFormatsModule = require('ajv-formats');
/** @type {typeof import('ajv-formats').default} */
const addFormats = addFormatsModule.default ?? addFormatsModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMAS = path.join(ROOT, 'schemas');
const DATA = path.join(ROOT, 'public/data');

/**
 * @param {string} name
 */
async function loadSchema(name) {
  return JSON.parse(await readFile(path.join(SCHEMAS, name), 'utf8'));
}

/**
 * @param {import('ajv').default} ajv
 * @param {string} schemaFile
 * @param {unknown} data
 * @param {string} label
 */
function assertValid(ajv, schemaFile, data, label) {
  const validate = ajv.getSchema(`https://cowx.dev/schemas/${schemaFile}`);
  if (!validate) throw new Error(`schema not registered: ${schemaFile}`);
  const ok = validate(data);
  if (!ok) {
    const details = (validate.errors ?? [])
      .slice(0, 8)
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    throw new Error(`${label} failed schema ${schemaFile}: ${details}`);
  }
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const location = await loadSchema('location.schema.json');
  const locationsArray = await loadSchema('locations-array.schema.json');
  const meta = await loadSchema('meta.schema.json');
  const indexEntry = await loadSchema('index-entry.schema.json');
  const spaceWeather = await loadSchema('space-weather.schema.json');

  ajv.addSchema(location);
  ajv.addSchema(locationsArray);
  ajv.addSchema(meta);
  ajv.addSchema(indexEntry);
  ajv.addSchema(spaceWeather);

  const catalog = JSON.parse(
    await readFile(path.join(ROOT, 'scripts/locations/colorado-locations.json'), 'utf8'),
  );
  assertValid(ajv, 'locations-array.schema.json', catalog, 'colorado-locations.json');

  const metaPath = path.join(DATA, 'meta.json');
  try {
    await access(metaPath);
    const metaData = JSON.parse(await readFile(metaPath, 'utf8'));
    assertValid(ajv, 'meta.schema.json', metaData, 'public/data/meta.json');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    console.warn('validate:schemas: skipping meta.json (not present)');
  }

  const spacePath = path.join(DATA, 'space-weather.json');
  try {
    await access(spacePath);
    const sw = JSON.parse(await readFile(spacePath, 'utf8'));
    assertValid(ajv, 'space-weather.schema.json', sw, 'public/data/space-weather.json');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    console.warn('validate:schemas: skipping space-weather.json (not present)');
  }

  const indexPath = path.join(DATA, 'index.json');
  try {
    await access(indexPath);
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const entries = Array.isArray(index?.locations) ? index.locations : [];
    const sample = entries.slice(0, 5);
    for (const [i, entry] of sample.entries()) {
      assertValid(ajv, 'index-entry.schema.json', entry, `index.json locations[${i}]`);
    }
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    console.warn('validate:schemas: skipping index.json sample (not present)');
  }

  console.log('validate:schemas: ok');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

export { main as validateSchemas };
