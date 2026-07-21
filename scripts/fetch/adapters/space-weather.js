/**
 * NOAA SWPC space weather snapshot for ham / RF context.
 * Failure point: SWPC JSON endpoints timeout or change shape.
 * Fallback: status error/partial; orchestrator may carry forward prior space-weather.json.
 */

import { fetchJson, sanitizeErrorMessage } from '../../lib/http.js';
import {
  estimateAuroraColorado,
  estimateHfConditions,
  xrayFluxToClass,
} from '../../lib/hf-conditions.js';
import { toFiniteNumber } from '../../lib/parse.js';

const SWPC = 'https://services.swpc.noaa.gov';

export const SPACE_WEATHER_LINKS = {
  swpc: 'https://www.swpc.noaa.gov/',
  scales: 'https://www.swpc.noaa.gov/noaa-scales-explanation',
  drap: 'https://www.swpc.noaa.gov/products/d-region-absorption-predictions-d-rap',
  prop: 'https://prop.kc2g.com/',
};

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function str(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

/**
 * Parse NOAA Scales product (keys "0" current, "1"…"3" forecast, "-1" previous).
 * @param {unknown} data
 * @returns {{
 *   R: { scale: number | null, text: string | null },
 *   S: { scale: number | null, text: string | null },
 *   G: { scale: number | null, text: string | null },
 *   observed: string | null,
 *   forecast: { date: string | null, R: object, S: object, G: object }[],
 * } | null}
 */
export function parseNoaaScales(data) {
  if (!data || typeof data !== 'object') return null;
  const obj = /** @type {Record<string, unknown>} */ (data);
  const current = obj['0'];
  if (!current || typeof current !== 'object') return null;

  /**
   * @param {unknown} entry
   * @param {'R' | 'S' | 'G'} key
   */
  function scaleOf(entry, key) {
    if (!entry || typeof entry !== 'object') return { scale: null, text: null };
    const block = /** @type {Record<string, unknown>} */ (entry)[key];
    if (!block || typeof block !== 'object') return { scale: null, text: null };
    const b = /** @type {Record<string, unknown>} */ (block);
    const scale = toFiniteNumber(b.Scale);
    return { scale, text: str(b.Text) };
  }

  /**
   * @param {unknown} entry
   */
  function stamp(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const e = /** @type {Record<string, unknown>} */ (entry);
    const d = str(e.DateStamp);
    const t = str(e.TimeStamp);
    if (d && t) return `${d}T${t}Z`;
    return d;
  }

  const forecast = [];
  for (const key of ['1', '2', '3']) {
    const entry = obj[key];
    if (!entry || typeof entry !== 'object') continue;
    const e = /** @type {Record<string, unknown>} */ (entry);
    forecast.push({
      date: str(e.DateStamp),
      R: scaleOf(entry, 'R'),
      S: scaleOf(entry, 'S'),
      G: scaleOf(entry, 'G'),
    });
  }

  return {
    R: scaleOf(current, 'R'),
    S: scaleOf(current, 'S'),
    G: scaleOf(current, 'G'),
    observed: stamp(current),
    forecast,
  };
}

/**
 * Latest planetary Kp from 1-minute estimated series.
 * @param {unknown} data
 * @returns {{ value: number, observed: string | null, source: string } | null}
 */
export function parsePlanetaryKp(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const last = /** @type {Record<string, unknown>} */ (data[data.length - 1]);
  const value =
    toFiniteNumber(last.estimated_kp) ?? toFiniteNumber(last.kp_index) ?? toFiniteNumber(last.Kp);
  if (value == null) return null;
  return {
    value,
    observed: str(last.time_tag),
    source: 'planetary',
  };
}

/**
 * Latest Boulder local K index.
 * @param {unknown} data
 * @returns {{ value: number, observed: string | null } | null}
 */
export function parseBoulderKp(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const last = /** @type {Record<string, unknown>} */ (data[data.length - 1]);
  const value =
    toFiniteNumber(last.k_index) ?? toFiniteNumber(last.kp_index) ?? toFiniteNumber(last.Kp);
  if (value == null) return null;
  return { value, observed: str(last.time_tag) };
}

/**
 * Latest F10.7 cm flux (SFI) — prefer Noon schedule when present.
 * @param {unknown} data
 * @returns {{ value: number, observed: string | null, ninety_day_mean: number | null } | null}
 */
export function parseSolarFlux(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  /** @type {Record<string, unknown>[]} */
  const rows = data.filter((r) => r && typeof r === 'object');
  if (!rows.length) return null;

  const noon = rows.find(
    (r) => String(r.reporting_schedule ?? '') === 'Noon' && toFiniteNumber(r.flux) != null,
  );
  const pick = noon ?? rows[0];
  const value = toFiniteNumber(pick.flux);
  if (value == null) return null;
  return {
    value: Math.round(value),
    observed: str(pick.time_tag),
    ninety_day_mean:
      toFiniteNumber(pick.ninety_day_mean) != null
        ? Math.round(Number(pick.ninety_day_mean))
        : null,
  };
}

/**
 * Latest GOES long-channel (0.1–0.8 nm) soft X-ray flux → flare class.
 * @param {unknown} data
 * @returns {{ class: string | null, flux: number | null, observed: string | null } | null}
 */
export function parseGoesXray(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const longChannel = data.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      String(/** @type {Record<string, unknown>} */ (r).energy) === '0.1-0.8nm',
  );
  const rows = longChannel.length ? longChannel : data;
  const last = /** @type {Record<string, unknown>} */ (rows[rows.length - 1]);
  const flux = toFiniteNumber(last.flux);
  if (flux == null) return null;
  return {
    class: xrayFluxToClass(flux),
    flux,
    observed: str(last.time_tag),
  };
}

/**
 * Build the public space-weather.json snapshot from parsed pieces.
 * @param {{
 *   scales?: ReturnType<typeof parseNoaaScales>,
 *   kp?: ReturnType<typeof parsePlanetaryKp>,
 *   boulder_kp?: ReturnType<typeof parseBoulderKp>,
 *   sfi?: ReturnType<typeof parseSolarFlux>,
 *   xray?: ReturnType<typeof parseGoesXray>,
 *   generatedAt?: string,
 * }} parts
 */
export function buildSpaceWeatherSnapshot(parts) {
  const kpVal = parts.kp?.value ?? null;
  const sfiVal = parts.sfi?.value ?? null;
  return {
    generatedAt: parts.generatedAt ?? new Date().toISOString(),
    kp: parts.kp ?? null,
    boulder_kp: parts.boulder_kp ?? null,
    sfi: parts.sfi ?? null,
    scales: parts.scales
      ? {
          R: parts.scales.R,
          S: parts.scales.S,
          G: parts.scales.G,
          observed: parts.scales.observed,
          forecast: parts.scales.forecast,
        }
      : null,
    xray: parts.xray ?? null,
    aurora_co: estimateAuroraColorado(kpVal),
    hf: estimateHfConditions(sfiVal, kpVal),
    links: { ...SPACE_WEATHER_LINKS },
  };
}

/**
 * @returns {Promise<{
 *   status: 'ok' | 'partial' | 'error',
 *   bySlug: Map<string, unknown>,
 *   snapshot: object | null,
 *   calls: number,
 *   error?: string,
 * }>}
 */
export async function fetchSpaceWeather() {
  const endpoints = [
    { id: 'scales', url: `${SWPC}/products/noaa-scales.json`, parse: parseNoaaScales },
    { id: 'kp', url: `${SWPC}/json/planetary_k_index_1m.json`, parse: parsePlanetaryKp },
    { id: 'boulder_kp', url: `${SWPC}/json/boulder_k_index_1m.json`, parse: parseBoulderKp },
    { id: 'sfi', url: `${SWPC}/json/f107_cm_flux.json`, parse: parseSolarFlux },
    { id: 'xray', url: `${SWPC}/json/goes/primary/xrays-6-hour.json`, parse: parseGoesXray },
  ];

  let calls = 0;
  /** @type {Record<string, unknown>} */
  const parsed = {};
  /** @type {string[]} */
  const errors = [];

  await Promise.all(
    endpoints.map(async (ep) => {
      try {
        calls += 1;
        const raw = await fetchJson(ep.url, { timeoutMs: 25_000 });
        const value = ep.parse(raw);
        if (value == null) {
          errors.push(`${ep.id}: empty parse`);
        } else {
          parsed[ep.id] = value;
        }
      } catch (err) {
        errors.push(`${ep.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  const got = Object.keys(parsed).length;
  if (got === 0) {
    return {
      status: 'error',
      bySlug: new Map(),
      snapshot: null,
      calls,
      error: sanitizeErrorMessage(errors.join('; ') || 'SWPC fetch failed'),
    };
  }

  const snapshot = buildSpaceWeatherSnapshot({
    scales: /** @type {any} */ (parsed.scales) ?? null,
    kp: /** @type {any} */ (parsed.kp) ?? null,
    boulder_kp: /** @type {any} */ (parsed.boulder_kp) ?? null,
    sfi: /** @type {any} */ (parsed.sfi) ?? null,
    xray: /** @type {any} */ (parsed.xray) ?? null,
  });

  const status = got === endpoints.length && errors.length === 0 ? 'ok' : 'partial';
  return {
    status,
    bySlug: new Map(),
    snapshot,
    calls,
    ...(errors.length ? { error: sanitizeErrorMessage(errors.join('; ')) } : {}),
  };
}
