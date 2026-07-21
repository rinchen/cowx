/**
 * Open-Meteo ERA5 archive → day-of-year climatology (1991–2020 normals window).
 * Failure point: archive timeout / 429 / weighted-call limits.
 * Fallback: return error/partial/skipped; orchestrator carries forward prior climatology.
 */

import { fetchJson, sleep } from '../../lib/http.js';

/** Standard NOAA-style normals window (reanalysis, not station normals). */
export const CLIMATOLOGY_PERIOD_START = '1991-01-01';
export const CLIMATOLOGY_PERIOD_END = '2020-12-31';
export const CLIMATOLOGY_SOURCE = 'open-meteo-era5';

/** Refresh when older than this (monthly gate). */
export const CLIMATOLOGY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const CHUNK = 8;
const CHUNK_DELAY_MS = 8_000;
const RETRY_BACKOFF_MS = 65_000;
/** Cap per orchestrator run so cold-start does not monopolize a 45-min job. */
export const DEFAULT_MAX_LOCS_PER_RUN = 24;

/** Leap-year cumulative days before each month (Jan=0). */
const LEAP_CUM_BEFORE_MONTH = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/**
 * Climate calendar index 0–365 (Jan 1 … Dec 31, with slot 59 = Feb 29).
 * Non-leap years never write slot 59; March–Dec still map to leap-year DOY slots.
 * @param {string} isoDate YYYY-MM-DD
 * @returns {number | null}
 */
export function climateDoyIndex(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).slice(0, 10));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (month === 2 && day === 29) return 59;
  const before = LEAP_CUM_BEFORE_MONTH[month - 1];
  if (before == null) return null;
  const idx = before + day - 1;
  return idx >= 0 && idx < 366 ? idx : null;
}

/**
 * @param {number | null | undefined} v
 * @returns {number | null}
 */
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Aggregate daily archive series into 366-slot DOY means.
 * @param {{
 *   time?: string[],
 *   temperature_2m_max?: (number | null)[],
 *   temperature_2m_min?: (number | null)[],
 *   precipitation_sum?: (number | null)[],
 * }} daily
 * @returns {{
 *   temperature_2m_max: (number | null)[],
 *   temperature_2m_min: (number | null)[],
 *   precipitation_sum: (number | null)[],
 * }}
 */
export function aggregateDailyToDoy(daily) {
  const times = Array.isArray(daily?.time) ? daily.time : [];
  const tmax = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const tmin = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const precip = Array.isArray(daily?.precipitation_sum) ? daily.precipitation_sum : [];

  const sumMax = new Float64Array(366);
  const sumMin = new Float64Array(366);
  const sumPrecip = new Float64Array(366);
  const nMax = new Uint16Array(366);
  const nMin = new Uint16Array(366);
  const nPrecip = new Uint16Array(366);

  for (let i = 0; i < times.length; i += 1) {
    const idx = climateDoyIndex(String(times[i]));
    if (idx == null) continue;
    const hi = numOrNull(tmax[i]);
    if (hi != null) {
      sumMax[idx] += hi;
      nMax[idx] += 1;
    }
    const lo = numOrNull(tmin[i]);
    if (lo != null) {
      sumMin[idx] += lo;
      nMin[idx] += 1;
    }
    const p = numOrNull(precip[i]);
    if (p != null) {
      sumPrecip[idx] += p;
      nPrecip[idx] += 1;
    }
  }

  /** @type {(number | null)[]} */
  const outMax = new Array(366);
  /** @type {(number | null)[]} */
  const outMin = new Array(366);
  /** @type {(number | null)[]} */
  const outPrecip = new Array(366);
  for (let i = 0; i < 366; i += 1) {
    outMax[i] = nMax[i] ? Math.round((sumMax[i] / nMax[i]) * 10) / 10 : null;
    outMin[i] = nMin[i] ? Math.round((sumMin[i] / nMin[i]) * 10) / 10 : null;
    outPrecip[i] = nPrecip[i] ? Math.round((sumPrecip[i] / nPrecip[i]) * 1000) / 1000 : null;
  }
  return {
    temperature_2m_max: outMax,
    temperature_2m_min: outMin,
    precipitation_sum: outPrecip,
  };
}

/**
 * Merge two DOY mean blocks by weighted average using sample counts.
 * When counts are unknown (prior means only), prefer `next` when present.
 * @param {ReturnType<typeof aggregateDailyToDoy> | null} prior
 * @param {ReturnType<typeof aggregateDailyToDoy>} next
 * @returns {ReturnType<typeof aggregateDailyToDoy>}
 */
export function mergeDoyMeans(prior, next) {
  if (!prior) return next;
  /** @type {(number | null)[]} */
  const temperature_2m_max = new Array(366);
  /** @type {(number | null)[]} */
  const temperature_2m_min = new Array(366);
  /** @type {(number | null)[]} */
  const precipitation_sum = new Array(366);
  for (let i = 0; i < 366; i += 1) {
    temperature_2m_max[i] = next.temperature_2m_max[i] ?? prior.temperature_2m_max[i] ?? null;
    temperature_2m_min[i] = next.temperature_2m_min[i] ?? prior.temperature_2m_min[i] ?? null;
    precipitation_sum[i] = next.precipitation_sum[i] ?? prior.precipitation_sum[i] ?? null;
  }
  return { temperature_2m_max, temperature_2m_min, precipitation_sum };
}

/**
 * Accumulate raw daily rows into running DOY sums (for multi-slice fetches).
 * @returns {{
 *   sumMax: Float64Array,
 *   sumMin: Float64Array,
 *   sumPrecip: Float64Array,
 *   nMax: Uint16Array,
 *   nMin: Uint16Array,
 *   nPrecip: Uint16Array,
 * }}
 */
export function createDoyAccumulators() {
  return {
    sumMax: new Float64Array(366),
    sumMin: new Float64Array(366),
    sumPrecip: new Float64Array(366),
    nMax: new Uint16Array(366),
    nMin: new Uint16Array(366),
    nPrecip: new Uint16Array(366),
  };
}

/**
 * @param {ReturnType<typeof createDoyAccumulators>} acc
 * @param {{
 *   time?: string[],
 *   temperature_2m_max?: (number | null)[],
 *   temperature_2m_min?: (number | null)[],
 *   precipitation_sum?: (number | null)[],
 * }} daily
 */
export function accumulateDailyIntoDoy(acc, daily) {
  const times = Array.isArray(daily?.time) ? daily.time : [];
  const tmax = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const tmin = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const precip = Array.isArray(daily?.precipitation_sum) ? daily.precipitation_sum : [];
  for (let i = 0; i < times.length; i += 1) {
    const idx = climateDoyIndex(String(times[i]));
    if (idx == null) continue;
    const hi = numOrNull(tmax[i]);
    if (hi != null) {
      acc.sumMax[idx] += hi;
      acc.nMax[idx] += 1;
    }
    const lo = numOrNull(tmin[i]);
    if (lo != null) {
      acc.sumMin[idx] += lo;
      acc.nMin[idx] += 1;
    }
    const p = numOrNull(precip[i]);
    if (p != null) {
      acc.sumPrecip[idx] += p;
      acc.nPrecip[idx] += 1;
    }
  }
}

/**
 * @param {ReturnType<typeof createDoyAccumulators>} acc
 * @returns {ReturnType<typeof aggregateDailyToDoy>}
 */
export function finalizeDoyAccumulators(acc) {
  /** @type {(number | null)[]} */
  const temperature_2m_max = new Array(366);
  /** @type {(number | null)[]} */
  const temperature_2m_min = new Array(366);
  /** @type {(number | null)[]} */
  const precipitation_sum = new Array(366);
  for (let i = 0; i < 366; i += 1) {
    temperature_2m_max[i] = acc.nMax[i]
      ? Math.round((acc.sumMax[i] / acc.nMax[i]) * 10) / 10
      : null;
    temperature_2m_min[i] = acc.nMin[i]
      ? Math.round((acc.sumMin[i] / acc.nMin[i]) * 10) / 10
      : null;
    precipitation_sum[i] = acc.nPrecip[i]
      ? Math.round((acc.sumPrecip[i] / acc.nPrecip[i]) * 1000) / 1000
      : null;
  }
  return { temperature_2m_max, temperature_2m_min, precipitation_sum };
}

/**
 * @param {string} start YYYY-MM-DD
 * @param {string} end YYYY-MM-DD
 * @param {number} [yearsPerSlice]
 * @returns {{ start: string, end: string }[]}
 */
export function yearSlices(start, end, yearsPerSlice = 5) {
  const startY = Number(start.slice(0, 4));
  const endY = Number(end.slice(0, 4));
  /** @type {{ start: string, end: string }[]} */
  const slices = [];
  for (let y = startY; y <= endY; y += yearsPerSlice) {
    const sliceStart = y === startY ? start : `${y}-01-01`;
    const lastY = Math.min(y + yearsPerSlice - 1, endY);
    const sliceEnd = lastY === endY ? end : `${lastY}-12-31`;
    slices.push({ start: sliceStart, end: sliceEnd });
  }
  return slices;
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 * @param {string} startDate
 * @param {string} endDate
 */
function buildArchiveUrl(chunk, startDate, endDate) {
  const lats = chunk.map((l) => l.lat).join(',');
  const lons = chunk.map((l) => l.lon).join(',');
  return (
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FDenver`
  );
}

/**
 * @param {unknown} climatology
 * @param {number} [nowMs]
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
export function climatologyIsFresh(
  climatology,
  nowMs = Date.now(),
  maxAgeMs = CLIMATOLOGY_MAX_AGE_MS,
) {
  if (!climatology || typeof climatology !== 'object') return false;
  const fetchedAt = /** @type {{ fetchedAt?: unknown }} */ (climatology).fetchedAt;
  if (typeof fetchedAt !== 'string') return false;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return false;
  const doy = /** @type {{ doy?: unknown }} */ (climatology).doy;
  if (!doy || typeof doy !== 'object') return false;
  const tmax = /** @type {{ temperature_2m_max?: unknown }} */ (doy).temperature_2m_max;
  if (!Array.isArray(tmax) || tmax.length < 365) return false;
  return nowMs - t < maxAgeMs;
}

/**
 * Build climatology payload from DOY means.
 * @param {ReturnType<typeof aggregateDailyToDoy>} doy
 * @param {string} [fetchedAt]
 */
export function buildClimatologyPayload(doy, fetchedAt = new Date().toISOString()) {
  return {
    fetchedAt,
    periodStart: CLIMATOLOGY_PERIOD_START,
    periodEnd: CLIMATOLOGY_PERIOD_END,
    source: CLIMATOLOGY_SOURCE,
    doy,
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{
 *   maxLocs?: number,
 *   periodStart?: string,
 *   periodEnd?: string,
 *   fetchJsonFn?: typeof fetchJson,
 *   sleepFn?: typeof sleep,
 * }} [opts]
 * @returns {Promise<{
 *   status: 'ok' | 'partial' | 'error' | 'skipped',
 *   bySlug: Map<string, object>,
 *   calls: number,
 *   error?: string,
 * }>}
 */
export async function fetchOpenMeteoClimatology(locations, opts = {}) {
  const maxLocs = opts.maxLocs ?? DEFAULT_MAX_LOCS_PER_RUN;
  const periodStart = opts.periodStart ?? CLIMATOLOGY_PERIOD_START;
  const periodEnd = opts.periodEnd ?? CLIMATOLOGY_PERIOD_END;
  const fetchJsonFn = opts.fetchJsonFn ?? fetchJson;
  const sleepFn = opts.sleepFn ?? sleep;

  if (!locations.length) {
    return { status: 'skipped', bySlug: new Map(), calls: 0 };
  }

  const targets = locations.slice(0, Math.max(0, maxLocs));
  const slices = yearSlices(periodStart, periodEnd, 5);
  /** @type {Map<string, ReturnType<typeof createDoyAccumulators>>} */
  const accBySlug = new Map();
  for (const loc of targets) {
    accBySlug.set(loc.slug, createDoyAccumulators());
  }

  let calls = 0;
  /** @type {string[]} */
  const errors = [];

  for (let i = 0; i < targets.length; i += CHUNK) {
    if (i > 0) await sleepFn(CHUNK_DELAY_MS);
    const chunk = targets.slice(i, i + CHUNK);
    for (let s = 0; s < slices.length; s += 1) {
      if (s > 0) await sleepFn(2_000);
      const { start, end } = slices[s];
      try {
        calls += 1;
        const data = await fetchJsonFn(buildArchiveUrl(chunk, start, end), {
          timeoutMs: 120_000,
        });
        const results = Array.isArray(data) ? data : [data];
        for (let j = 0; j < chunk.length; j += 1) {
          const loc = chunk[j];
          const r = results[j];
          const daily = r?.daily;
          const acc = accBySlug.get(loc.slug);
          if (!daily || !acc) continue;
          accumulateDailyIntoDoy(acc, daily);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${start}…${end}: ${msg}`);
        if (msg.includes('429')) {
          console.warn('openmeteo-climatology: 429 — backing off 65s');
          await sleepFn(RETRY_BACKOFF_MS);
        } else {
          await sleepFn(5_000);
        }
      }
    }
  }

  /** @type {Map<string, object>} */
  const bySlug = new Map();
  const fetchedAt = new Date().toISOString();
  for (const loc of targets) {
    const acc = accBySlug.get(loc.slug);
    if (!acc) continue;
    const doy = finalizeDoyAccumulators(acc);
    const filled = doy.temperature_2m_max.filter((v) => v != null).length;
    if (filled < 300) continue;
    bySlug.set(loc.slug, buildClimatologyPayload(doy, fetchedAt));
  }

  const coverage = bySlug.size / Math.max(targets.length, 1);
  console.log(
    `openmeteo-climatology: coverage ${bySlug.size}/${targets.length}` +
      ` (${(coverage * 100).toFixed(1)}%), ${calls} calls`,
  );

  if (bySlug.size === 0) {
    return {
      status: 'error',
      bySlug,
      calls,
      error: errors.join('; ') || 'no climatology rows',
    };
  }
  if (errors.length > 0 || coverage < 0.95 || targets.length < locations.length) {
    return {
      status: 'partial',
      bySlug,
      calls,
      error:
        errors.join('; ') ||
        (targets.length < locations.length
          ? `refreshed ${targets.length}/${locations.length} (cap ${maxLocs})`
          : `coverage ${(coverage * 100).toFixed(1)}%`),
    };
  }
  return { status: 'ok', bySlug, calls };
}
