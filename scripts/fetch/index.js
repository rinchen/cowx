#!/usr/bin/env node
/**
 * Colorado Weather fetch orchestrator.
 * Failure point: all critical adapters fail or zero locations written → exit 1.
 * Fallback: partial source failures recorded in meta.json; carry-forward prior forecast on Open-Meteo miss.
 */

import { access, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeErrorMessage } from '../lib/http.js';
import { runAdapterSafely } from '../lib/adapter-runner.js';
import { buildAstronomy } from '../lib/astronomy.js';
import { buildPollenHealthLinks } from '../lib/pollen-links.js';
import { validateLocationsData } from '../validate-locations.js';
import { fetchOpenMeteo } from './adapters/openmeteo.js';
import { fetchOpenMeteoAq } from './adapters/openmeteo-aq.js';
import {
  climatologyIsFresh,
  DEFAULT_MAX_LOCS_PER_RUN,
  fetchOpenMeteoClimatology,
} from './adapters/openmeteo-climatology.js';
import { alertsForLocation, fetchNws } from './adapters/nws.js';
import { fetchCoagmet } from './adapters/coagmet.js';
import { fetchAviation } from './adapters/aviation.js';
import { fetchPurpleAir } from './adapters/purpleair.js';
import { fetchAirNow } from './adapters/airnow.js';
import { fetchUsgs } from './adapters/usgs.js';
import { fetchSnotel } from './adapters/snotel.js';
import { fetchCdot } from './adapters/cdot.js';
import { fetchCwop } from './adapters/cwop.js';
import { fetchHms } from './adapters/hms.js';
import { fetchSpcFireWx } from './adapters/spc-firewx.js';
import { fetchNifcFires } from './adapters/nifc-fires.js';
import { fetchBurnRestrictions } from './adapters/burn-restrictions.js';
import { fetchSpaceWeather } from './adapters/space-weather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'public/data');
const LOCATIONS_DIR = path.join(DATA_DIR, 'locations');
const LOCATIONS_PATH = path.join(ROOT, 'scripts/locations/colorado-locations.json');
const ZIPS_SRC = path.join(ROOT, 'scripts/locations/co-zips.json');
const ZIPS_DST = path.join(DATA_DIR, 'co-zips.json');
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Resolve a location JSON path under public/data/locations/ (rejects path escape).
 * @param {string} slug
 * @returns {string}
 */
export function locationPayloadPath(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`invalid location slug: ${String(slug)}`);
  }
  const resolvedDir = path.resolve(LOCATIONS_DIR);
  const filePath = path.resolve(resolvedDir, `${slug}.json`);
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`;
  if (!filePath.startsWith(prefix)) {
    throw new Error(`location path escaped data dir for slug: ${slug}`);
  }
  return filePath;
}

/**
 * Keep only webcam_links that pass the same https:// rule as validate-locations.
 * Invalid entries are dropped (not written into payloads).
 * @param {unknown} links
 * @returns {{ name: string, url: string, kind?: string }[]}
 */
export function sanitizeWebcamLinks(links) {
  if (!Array.isArray(links)) return [];
  /** @type {{ name: string, url: string, kind?: string }[]} */
  const out = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const name = /** @type {{ name?: unknown }} */ (link).name;
    const url = /** @type {{ url?: unknown }} */ (link).url;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) continue;
    try {
      if (new URL(url).protocol !== 'https:') continue;
    } catch {
      continue;
    }
    /** @type {{ name: string, url: string, kind?: string }} */
    const entry = { name: name.trim(), url };
    const kind = /** @type {{ kind?: unknown }} */ (link).kind;
    if (typeof kind === 'string' && kind) entry.kind = kind;
    out.push(entry);
  }
  return out;
}

/**
 * @param {string} slug
 * @returns {Promise<object | null>}
 */
async function readPrior(slug) {
  try {
    const raw = await readFile(locationPayloadPath(slug), 'utf8');
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
  const catalogErrors = validateLocationsData(locations);
  if (catalogErrors.length) {
    throw new Error(`colorado-locations.json invalid:\n${catalogErrors.slice(0, 20).join('\n')}`);
  }

  await mkdir(LOCATIONS_DIR, { recursive: true });

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
    const extra = detail ? detail(result) : `(${result.bySlug?.size ?? 0} locs)`;
    console.log(`  ${id}: ${result.status}${extra ? ` ${extra}` : ''}`);
    return result;
  }

  const openmeteo = await runAdapter('openmeteo', () => fetchOpenMeteo(locations));
  const openmeteoAq = await runAdapter('openmeteo_aq', () => fetchOpenMeteoAq(locations));
  const climatology = await runAdapter('openmeteo_climatology', () =>
    runClimatologyAdapter(locations),
  );
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
  const hms = await runAdapter(
    'hms',
    () => fetchHms(locations),
    () => '',
  );
  const spcFireWx = await runAdapter(
    'spc_firewx',
    () => fetchSpcFireWx(locations),
    () => '',
  );
  const nifcFires = await runAdapter(
    'nifc_fires',
    () => fetchNifcFires(locations),
    () => '',
  );
  const burnRestrictions = await runAdapter(
    'burn_restrictions',
    () => fetchBurnRestrictions(locations),
    () => '',
  );
  const spaceWeather = await runAdapter(
    'space_weather',
    () => fetchSpaceWeather(),
    (r) => (r.snapshot ? '(snapshot)' : ''),
  );

  const updatedAt = new Date().toISOString();
  const index = [];
  let staleCount = 0;

  /** @type {{ zip: string, lat: number, lon: number, city?: string }[]} */
  let zipPoints = [];
  try {
    zipPoints = JSON.parse(await readFile(ZIPS_SRC, 'utf8'));
  } catch (err) {
    console.warn(
      `fetch: could not load co-zips.json for pollen links — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const loc of locations) {
    try {
      const om = openmeteo.bySlug.get(loc.slug);
      const prior = await readPrior(loc.slug);
      let current = om?.current ?? null;
      let hourly = om?.hourly ?? null;
      let daily = om?.daily ?? null;
      let forecastStale = false;
      let astronomy = om?.astronomy ?? null;
      if (!astronomy) {
        try {
          astronomy = buildAstronomy(loc.lat, loc.lon);
        } catch {
          astronomy = prior?.astronomy ?? null;
        }
      }

      if (!current && prior?.current) {
        current = prior.current;
        hourly = prior.hourly ?? null;
        daily = prior.daily ?? null;
        forecastStale = true;
        staleCount += 1;
      }

      const pollenHealth = buildPollenHealthLinks(loc, zipPoints);

      const countyKey = String(loc.county ?? '').toLowerCase();
      let alerts = [];
      try {
        alerts = alertsForLocation(
          loc.lat,
          loc.lon,
          countyKey,
          nws.byCounty ?? new Map(),
          nws.alertsGeoJson ?? { type: 'FeatureCollection', features: [] },
        );
      } catch (err) {
        console.warn(
          `fetch: alertsForLocation failed for ${loc.slug} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
      const pwsRec = cwop.pwsBySlug?.get(loc.slug) ?? null;
      const hmsRec = hms.bySlug.get(loc.slug) ?? null;
      const fireWeather = spcFireWx.bySlug.get(loc.slug) ?? null;
      const nearbyFires = nifcFires.bySlug.get(loc.slug) ?? null;
      const fireRestrictions = burnRestrictions.bySlug.get(loc.slug) ?? null;
      const webcamLinks = sanitizeWebcamLinks(loc.webcam_links);

      const climatologyRec =
        climatology.bySlug.get(loc.slug) ??
        (prior?.climatology && typeof prior.climatology === 'object' ? prior.climatology : null);

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
        astronomy,
        climatology: climatologyRec,
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
        cdot_roads: cdotRec?.cdot_roads ?? null,
        cwop: cwopRec,
        pws: pwsRec,
        hms_smoke: hmsRec,
        fire_weather: fireWeather,
        nearby_fires: nearbyFires,
        fire_restrictions: fireRestrictions,
        rf_comms: om?.rf_comms ?? prior?.rf_comms ?? null,
        links: {
          nws_forecast: `https://forecast.weather.gov/MapClick.php?lat=${loc.lat}&lon=${loc.lon}`,
          pws: loc.pws_id
            ? `https://www.wunderground.com/dashboard/pws/${encodeURIComponent(loc.pws_id)}`
            : null,
          pollen: pollenHealth.pollen,
          pollen_zip: pollenHealth.pollen_zip,
          pollen_city: pollenHealth.pollen_city,
          nab_links: pollenHealth.nab_links,
          purpleair_map: 'https://map.purpleair.com/',
          airnow: 'https://www.airnow.gov/',
          coagmet: ag?.url ?? 'https://coagmet.colostate.edu/',
          aviation: av?.url ?? 'https://aviationweather.gov/',
          rainviewer: 'https://www.rainviewer.com/map.html',
          usgs: gauge?.url ?? 'https://waterdata.usgs.gov/nwis/rt',
          snotel: snow?.url ?? 'https://www.nrcs.usda.gov/wps/portal/wcc/home/',
          cotrip: 'https://maps.cotrip.org/',
          webcam_links: webcamLinks,
        },
      };

      await writeFile(locationPayloadPath(loc.slug), JSON.stringify(payload), 'utf8');

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
        uv_index: current?.uv_index ?? null,
        aqi: an?.aqi ?? pa?.aqi_pm25 ?? omaq?.us_aqi ?? null,
        nws_alert: alerts.length > 0,
        forecast_stale: forecastStale,
        updated_at: updatedAt,
      });
    } catch (err) {
      console.warn(
        `fetch: skipped location ${loc.slug} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    path.join(DATA_DIR, 'cdot-alerts.geojson'),
    JSON.stringify(cdot.alertsGeoJson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  await writeFile(
    path.join(DATA_DIR, 'cwop.geojson'),
    JSON.stringify(cwop.geojson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  await writeFile(
    path.join(DATA_DIR, 'hms-smoke.geojson'),
    JSON.stringify(hms.smokeGeoJson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  await writeFile(
    path.join(DATA_DIR, 'spc-firewx.geojson'),
    JSON.stringify(spcFireWx.fireWxGeoJson ?? { type: 'FeatureCollection', features: [] }),
    'utf8',
  );

  let spaceWeatherSnapshot = spaceWeather.snapshot ?? null;
  if (!spaceWeatherSnapshot) {
    try {
      const priorSw = JSON.parse(await readFile(path.join(DATA_DIR, 'space-weather.json'), 'utf8'));
      if (priorSw && typeof priorSw === 'object') {
        spaceWeatherSnapshot = { ...priorSw, carriedForward: true };
        const swMeta = sources.find((s) => s.id === 'space_weather');
        if (swMeta) {
          swMeta.status = 'partial';
          swMeta.error = sanitizeErrorMessage(
            [swMeta.error, 'carried forward prior space-weather.json'].filter(Boolean).join('; '),
          );
        }
      }
    } catch {
      /* no prior snapshot */
    }
  }
  if (spaceWeatherSnapshot) {
    if (!spaceWeatherSnapshot.generatedAt) spaceWeatherSnapshot.generatedAt = updatedAt;
    await writeFile(
      path.join(DATA_DIR, 'space-weather.json'),
      `${JSON.stringify(spaceWeatherSnapshot, null, 2)}\n`,
      'utf8',
    );
  }

  try {
    await copyFile(ZIPS_SRC, ZIPS_DST);
  } catch (err) {
    console.warn(
      `fetch: could not copy co-zips.json — ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      await access(ZIPS_DST);
      console.warn('fetch: keeping prior public/data/co-zips.json');
    } catch {
      await writeFile(ZIPS_DST, '[]', 'utf8');
      console.warn('fetch: wrote empty co-zips.json fallback (no prior file)');
    }
  }

  const criticalOk =
    openmeteo.status === 'ok' ||
    openmeteo.status === 'partial' ||
    nws.status === 'ok' ||
    nws.status === 'partial' ||
    staleCount > 0;

  const meta = {
    generatedAt: updatedAt,
    version: '1.2.0',
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
 * Monthly (or cold-start) ERA5 climatology refresh; skips when all locations are fresh.
 * @param {import('../lib/types.js').Location[]} locations
 */
async function runClimatologyAdapter(locations) {
  if (process.env.SKIP_CLIMATOLOGY === '1') {
    return { status: 'skipped', bySlug: new Map(), calls: 0 };
  }

  const force = process.env.FORCE_CLIMATOLOGY === '1';
  const maxLocs = force
    ? Number(process.env.CLIMATOLOGY_MAX_LOCS || locations.length) || locations.length
    : Number(process.env.CLIMATOLOGY_MAX_LOCS || DEFAULT_MAX_LOCS_PER_RUN) ||
      DEFAULT_MAX_LOCS_PER_RUN;

  /** @type {import('../lib/types.js').Location[]} */
  const stale = [];
  for (const loc of locations) {
    const prior = await readPrior(loc.slug);
    if (force || !climatologyIsFresh(prior?.climatology)) {
      stale.push(loc);
    }
  }

  if (!stale.length) {
    console.log('openmeteo-climatology: all locations fresh — skipping');
    return { status: 'skipped', bySlug: new Map(), calls: 0 };
  }

  console.log(
    `openmeteo-climatology: refreshing ${Math.min(stale.length, maxLocs)}/${stale.length} stale locations`,
  );
  return fetchOpenMeteoClimatology(stale, { maxLocs });
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
