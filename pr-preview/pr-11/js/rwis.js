/**
 * CDOT RWIS presentation helpers (client).
 * CDOT’s public “Live” ArcGIS weather layer has been frozen since 2021 — never show
 * those readings as current without a freshness check.
 */

/** Match scripts/fetch/adapters/cdot.js */
export const RWIS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string | null | undefined} observed
 * @param {number} [nowMs]
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
export function isRwisObservationFresh(observed, nowMs = Date.now(), maxAgeMs = RWIS_MAX_AGE_MS) {
  if (typeof observed !== 'string' || !observed) return false;
  const t = Date.parse(observed);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs;
}

/**
 * Fields safe to show as live RWIS conditions (null when stale / missing).
 * @param {Record<string, unknown> | null | undefined} rwis
 * @param {number} [nowMs]
 */
export function rwisLiveReadings(rwis, nowMs = Date.now()) {
  if (!rwis || typeof rwis !== 'object') {
    return {
      fresh: false,
      air_temp_f: null,
      surface_temp_f: null,
      surface_status: null,
      wind_speed_mph: null,
      humidity: null,
      observed: null,
    };
  }
  const observed = rwis.observed != null ? String(rwis.observed) : null;
  const flaggedStale = rwis.readings_stale === true;
  const fresh = !flaggedStale && isRwisObservationFresh(observed, nowMs);
  if (!fresh) {
    return {
      fresh: false,
      air_temp_f: null,
      surface_temp_f: null,
      surface_status: null,
      wind_speed_mph: null,
      humidity: null,
      observed,
    };
  }
  return {
    fresh: true,
    air_temp_f: rwis.air_temp_f != null ? Number(rwis.air_temp_f) : null,
    surface_temp_f: rwis.surface_temp_f != null ? Number(rwis.surface_temp_f) : null,
    surface_status: rwis.surface_status != null ? String(rwis.surface_status) : null,
    wind_speed_mph: rwis.wind_speed_mph != null ? Number(rwis.wind_speed_mph) : null,
    humidity: rwis.humidity != null ? Number(rwis.humidity) : null,
    observed,
  };
}
