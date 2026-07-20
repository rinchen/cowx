#!/usr/bin/env node
/**
 * Colorado Weather fetch orchestrator.
 * Failure point: all critical adapters fail or zero locations written → exit 1.
 * Fallback: partial source failures recorded in meta.json; carry-forward prior forecast on Open-Meteo miss.
 */

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeErrorMessage } from '../lib/http.js';
import { runAdapterSafely } from '../lib/adapter-runner.js';
import { fetchOpenMeteo } from './adapters/openmeteo.js';
import { fetchOpenMeteoAq } from './adapters/openmeteo-aq.js';
import { alertsForLocation, fetchNws } from './adapters/nws.js';
import { fetchCoagmet } from './adapters/coagmet.js';
import { fetchAviation } from './adapters/aviation.js';
import { fetchPurpleAir } from './adapters/purpleair.js';
import { fetchAirNow } from './adapters/airnow.js';
import { fetchUsgs } from './adapters/usgs.js';
import { fetchSnotel } from './adapters/snotel.js';
import { fetchCdot } from './adapters/cdot.js';
import { fetchCwop } from './adapters/cwop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'public/data');
const LOCATIONS_PATH = path.join(ROOT, 'scripts/locations/colorado-locations.json');
const ZIPS_SRC = path.join(ROOT, 'scripts/locations/co-zips.json');
const ZIPS_DST = path.join(DATA_DIR, 'co-zips.json');

/**
 * @param {string} slug
 * @returns {Promise<object | null>}
 */
async function readPrior(slug) {
  try {
    const raw = await readFile(path.join(DATA_DIR, 'locations', `${slug}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<void>}
 */
export async function runFetch() {
  const raw = await readFile(LOCATIONS_PATH, 'utf8');
  /** @type {import('../lib/types.js').Location[]} */
  const locations = JSON.parse(raw);
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new Error('colorado-locations.json is empty');
  }

  await mkdir(path.join(DATA_DIR, 'locations'), { recursive: true });

  /** @type {{ id: string, status: string, fetchedAt: string, error?: string }[]} */
  const sources = [];
  let totalCalls = 0;

  console.log(`fetch: ${locations.length} locations`);

  /**
   * Isolate adapter failures so one throw cannot abort the rest of the job.
   * @template T
   * @param {string} id
   * @param {() => Promise<T>} fn
   * @param {(r: T) => string} [detail]
   * @returns {Promise<T & { status: string, bySlug: Map<string, unknown>, calls?: number, error?: string }>}
   */
  async function runAdapter(id, fn, detail) {
    const result = /** @type {any} */ (await runAdapterSafely(/** @type {any} */ (fn)));
    sources.push(sourceMeta(id, result));
    totalCalls += result.calls ?? 0;
    const extra = detail ? detail(result) : `(${result.bySlug.size} locs)`;
    console.log(`  ${id}: ${result.status}${extra ? ` ${extra}` : ''}`);
    return result;
  }

  const openmeteo = await runAdapter('openmeteo', () => fetchOpenMeteo(locations));
  const openmeteoAq = await runAdapter('openmeteo_aq', () => fetchOpenMeteoAq(locations));
  const nws = await runAdapter(
    'nws',
    () => fetchNws(),
    () => '',
  );
  const coagmet = await runAdapter('coagmet', () => fetchCoagmet(locations));
  const aviation = await runAdapter('aviation', () => fetchAviation(locations));
  const purpleair = await runAdapter('purpleair', () => fetchPurpleAir(locations));
  const airnow = await runAdapter('airnow', () => fetchAirNow(locations));
  const usgs = await runAdapter('usgs', () => fetchUsgs(locations));
  const snotel = await runAdapter('snotel', () => fetchSnotel(locations));
  const cdot = await runAdapter(
    'cdot',
    () => fetchCdot(locations),
    () => '',
  );
  const cwop = await runAdapter(
    'cwop',
    () => fetchCwop(locations),
    () => '',
  );

  const updatedAt = new Date().toISOString();
  const index = [];
  let staleCount = 0;

  for (const loc of locations) {
    const om = openmeteo.bySlug.get(loc.slug);
    const prior = om ? null : await readPrior(loc.slug);
    let current = om?.current ?? null;
    let hourly = om?.hourly ?? null;
    let daily = om?.daily ?? null;
    let forecastStale = false;

    if (!current && prior?.current) {
      current = prior.current;
      hourly = prior.hourly ?? null;
      daily = prior.daily ?? null;
      forecastStale = true;
      staleCount += 1;
    }

    const countyKey = String(loc.county ?? '').toLowerCase();
    const alerts = alertsForLocation(
      loc.lat,
      loc.lon,
      countyKey,
      nws.byCounty ?? new Map(),
      nws.alertsGeoJson ?? { type: 'FeatureCollection', features: [] },
    );
    const afd = nws.afdByWfo?.get(loc.wfo) ?? null;
    const hwo = nws.hwoByWfo?.get(loc.wfo) ?? null;
    const ag = coagmet.bySlug.get(loc.slug) ?? null;
    const av = aviation.bySlug.get(loc.slug) ?? null;
    const pa = purpleair.bySlug.get(loc.slug) ?? null;
    const an = airnow.bySlug.get(loc.slug) ?? null;
    const omaq = openmeteoAq.bySlug.get(loc.slug) ?? null;
    const gauge = usgs.bySlug.get(loc.slug) ?? null;
    const snow = snotel.bySlug.get(loc.slug) ?? null;
    const cdotRec = cdot.bySlug.get(loc.slug) ?? null;
    const cwopRec = cwop.bySlug.get(loc.slug) ?? null;

    const payload = {
      slug: loc.slug,
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      region: loc.region,
      county: loc.county,
      wfo: loc.wfo,
      elevation_ft: loc.elevation_ft,
      icao: loc.icao ?? null,
      updatedAt,
      forecastStale,
      current,
      hourly,
      daily,
      alerts,
      afd,
      hwo,
      coagmet: ag,
      aviation: av,
      purpleair: pa,
      airnow: an,
      openmeteo_aq: omaq,
      usgs: gauge,
      snotel: snow,
      cdot_camera: cdotRec?.camera ?? null,
      cdot_rwis: cdotRec?.rwis ?? null,
      cwop: cwopRec,
      rf_comms: om?.rf_comms ?? prior?.rf_comms ?? null,
      links: {
        nws_forecast: `https://forecast.weather.gov/MapClick.php?lat=${loc.lat}&lon=${loc.lon}`,
        pws: loc.pws_id
          ? `https://www.wunderground.com/dashboard/pws/${encodeURIComponent(loc.pws_id)}`
          : null,
        purpleair_map: 'https://map.purpleair.com/',
        airnow: 'https://www.airnow.gov/',
        coagmet: ag?.url ?? 'https://coagmet.colostate.edu/',
        aviation: av?.url ?? 'https://aviationweather.gov/',
        rainviewer: 'https://www.rainviewer.com/map.html',
        usgs: gauge?.url ?? 'https://waterdata.usgs.gov/nwis/rt',
        snotel: snow?.url ?? 'https://www.nrcs.usda.gov/wps/portal/wcc/home/',
        cotrip: 'https://maps.cotrip.org/',
      },
    };

    await writeFile(
      path.join(DATA_DIR, 'locations', `${loc.slug}.json`),
      JSON.stringify(payload),
      'utf8',
    );

    index.push({
      slug: loc.slug,
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      region: loc.region,
      county: loc.county,
      elevation_ft: loc.elevation_ft,
      temp_f: current?.temp_f ?? null,
      condition: current?.condition ?? null,
      humidity: current?.humidity ?? null,
      wind_speed_mph: current?.wind_speed_mph ?? null,
      aqi: an?.aqi ?? pa?.aqi_pm25 ?? omaq?.us_aqi ?? null,
      nws_alert: alerts.length > 0,
      forecast_stale: forecastStale,
      updated_at: updatedAt,
    });
  }

  await writeFile(
    path.join(DATA_DIR, 'index.json'),
    JSON.stringify({ updated_at: updatedAt, locations: index }),
    'utf8',
  );
  await writeFile(
    path.join(DATA_DIR, 'alerts.geojson'),
    JSON.stringify(nws.alertsGeoJson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  await writeFile(
    path.join(DATA_DIR, 'cdot-cameras.geojson'),
    JSON.stringify(cdot.camerasGeoJson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  await writeFile(
    path.join(DATA_DIR, 'cwop.geojson'),
    JSON.stringify(cwop.geojson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  try {
    await copyFile(ZIPS_SRC, ZIPS_DST);
  } catch {
    await writeFile(ZIPS_DST, '[]', 'utf8');
  }

  const criticalOk =
    openmeteo.status === 'ok' ||
    openmeteo.status === 'partial' ||
    nws.status === 'ok' ||
    nws.status === 'partial' ||
    staleCount > 0;

  const meta = {
    generatedAt: updatedAt,
    version: '1.1.0',
    sources,
    locationCount: index.length,
    apiCalls: totalCalls,
    forecastStaleCount: staleCount,
    openmeteoCoverage: openmeteo.bySlug.size,
  };
  await writeFile(path.join(DATA_DIR, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(
    `fetch: wrote ${index.length} locations, ${totalCalls} API calls, ${staleCount} stale forecasts`,
  );

  if (!criticalOk || index.length === 0) {
    throw new Error('Critical weather sources failed or no locations written');
  }
}

/**
 * @param {string} id
 * @param {{ status: string, error?: string }} result
 */
function sourceMeta(id, result) {
  return {
    id,
    status: result.status,
    fetchedAt: new Date().toISOString(),
    ...(result.error ? { error: sanitizeErrorMessage(result.error).slice(0, 500) } : {}),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runFetch().catch((err) => {
    console.error('fetch failed:', err);
    process.exitCode = 1;
  });
}
