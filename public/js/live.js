/**
 * Wall-clock “live” views over a location payload.
 *
 * Prefer these helpers over raw `data.current`, `data.astronomy`, `data.rf_comms`,
 * or `daily[0]` so the UI stays correct between ~45-minute fetches.
 */

import { buildAstronomy } from './astronomy.js';
import {
  dailyIndexForNow,
  denverDateKey,
  denverHourKey,
  precipTodayInches,
} from './denver-time.js';
import { nearestHourIndex, resolveCatalogNow } from './outlook.js';
import { estimateRfComms } from './rf-comms.js';

export { dailyIndexForNow, denverDateKey, denverHourKey, precipTodayInches, resolveCatalogNow };

/**
 * Astronomy for wall-clock now (recomputed locally — no network).
 * Falls back to payload astronomy only when lat/lon are missing.
 * @param {Record<string, unknown>} data
 * @param {number} [nowMs]
 * @returns {Record<string, unknown> | null}
 */
export function resolveAstronomy(data, nowMs = Date.now()) {
  const lat = Number(data?.lat);
  const lon = Number(data?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return buildAstronomy(lat, lon, new Date(nowMs));
  }
  const fallback = data?.astronomy;
  return fallback && typeof fallback === 'object'
    ? /** @type {Record<string, unknown>} */ (fallback)
    : null;
}

/**
 * RF ducting estimate from wall-clock current + nearest-hour 850 hPa.
 * Falls back to payload `rf_comms` when the profile series is missing.
 * @param {Record<string, unknown> | null | undefined} current
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {number | null | undefined} elevationFt
 * @param {Record<string, unknown> | null | undefined} [fallback]
 * @param {number} [nowMs]
 * @returns {Record<string, unknown> | null}
 */
export function resolveRfComms(current, hourly, elevationFt, fallback = null, nowMs = Date.now()) {
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  const series = /** @type {(number | null)[]} */ (hourly?.temperature_850hPa ?? []);
  if (times.length && series.length && current?.temp_f != null) {
    const hi = nearestHourIndex(times, nowMs);
    const t850 = series[hi];
    const estimated = estimateRfComms(current, t850, elevationFt);
    if (estimated) return /** @type {Record<string, unknown>} */ (estimated);
  }
  return fallback && typeof fallback === 'object'
    ? /** @type {Record<string, unknown>} */ (fallback)
    : null;
}
