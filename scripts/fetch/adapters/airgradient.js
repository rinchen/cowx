/**
 * AirGradient public world sensors → multi-sensor PM2.5 consensus per location.
 * Failure point: upstream timeout / empty CO coverage.
 * Fallback: status error/partial; UI uses AirNow / Open-Meteo AQ.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoints, roundKm } from '../../lib/geo.js';
import { CO_BBOX } from '../../lib/colorado.js';
import { toFiniteNumber } from '../../lib/parse.js';

const WORLD_URL = 'https://api.airgradient.com/public/api/v1/world/locations/measures/current';
const SOURCE_URL = 'https://www.airgradient.com/';
const PREFERRED_MAX_KM = 10;
const FALLBACK_MAX_KM = 25;
const MAX_SENSORS = 5;

/**
 * Median of a non-empty numeric array (sorts a copy).
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * @param {number[]} values
 * @returns {{ q1: number, q3: number, iqr: number }}
 */
function quartiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, mid);
  const upper = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  const q1 = median(lower.length ? lower : sorted);
  const q3 = median(upper.length ? upper : sorted);
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Drop PM outliers using median absolute deviation (more reliable than IQR on n≈3–5).
 * @param {{ name: string, distanceKm: number, pm25: number }[]} usable
 * @returns {{ name: string, distanceKm: number, pm25: number }[]}
 */
function trimPmOutliers(usable) {
  if (usable.length < 3) return usable;
  const pms = usable.map((s) => s.pm25);
  const med = median(pms);
  const absDevs = pms.map((v) => Math.abs(v - med));
  const mad = median(absDevs);
  if (!(mad > 0)) {
    const { q1, q3, iqr } = quartiles(pms);
    if (!(iqr > 0)) return usable;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const trimmed = usable.filter((s) => s.pm25 >= lo && s.pm25 <= hi);
    return trimmed.length ? trimmed : usable;
  }
  const limit = Math.max(10, 3 * 1.4826 * mad);
  const trimmed = usable.filter((s) => Math.abs(s.pm25 - med) <= limit);
  return trimmed.length ? trimmed : usable;
}

/**
 * @typedef {{ name: string, distance_km: number, pm25: number }} AirGradientSensorSample
 */

/**
 * Median PM2.5 consensus with MAD outlier trim when n ≥ 3.
 * @param {{ name?: string, distanceKm: number, pm25: number | null }[]} sensorsNear
 * @returns {{
 *   pm25: number,
 *   aqi_pm25: number | null,
 *   sensor_count: number,
 *   distance_km: number,
 *   max_distance_km: number,
 *   name: string,
 *   url: string,
 *   sensors: AirGradientSensorSample[],
 * } | null}
 */
export function airGradientConsensus(sensorsNear) {
  if (!Array.isArray(sensorsNear) || sensorsNear.length === 0) return null;

  /** @type {{ name: string, distanceKm: number, pm25: number }[]} */
  let usable = [];
  for (const s of sensorsNear) {
    const pm = toFiniteNumber(s.pm25);
    if (pm == null) continue;
    usable.push({
      name: String(s.name ?? 'AirGradient'),
      distanceKm: Number(s.distanceKm),
      pm25: pm,
    });
  }
  if (usable.length === 0) return null;

  usable = trimPmOutliers(usable);

  const pm25Raw = median(usable.map((s) => s.pm25));
  const pm25 = Math.round(pm25Raw * 10) / 10;
  const distances = usable.map((s) => s.distanceKm);
  const distance_km = roundKm(median(distances));
  const max_distance_km = roundKm(Math.max(...distances));
  const sensors = usable
    .slice()
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((s) => ({
      name: s.name,
      distance_km: roundKm(s.distanceKm),
      pm25: s.pm25,
    }));

  const nearestName = sensors[0]?.name ?? 'AirGradient';
  const name =
    sensors.length === 1
      ? nearestName
      : sensors.length === 2
        ? `${nearestName} +1`
        : `${sensors.length} outdoor sensors`;

  return {
    pm25,
    aqi_pm25: pm25ToAqi(pm25),
    sensor_count: sensors.length,
    distance_km,
    max_distance_km,
    name,
    url: SOURCE_URL,
    sensors,
  };
}

/**
 * Keep online Colorado sensors with a finite PM2.5 (`pm02`).
 * @param {unknown} raw
 * @returns {{ lat: number, lon: number, name: string, pm25: number, humidity: number | null, temperature_c: number | null }[]}
 */
export function filterCoAirGradientSensors(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  /** @type {{ lat: number, lon: number, name: string, pm25: number, humidity: number | null, temperature_c: number | null }[]} */
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    if (r.offline === true) continue;
    const lat = toFiniteNumber(r.latitude);
    const lon = toFiniteNumber(r.longitude);
    const pm25 = toFiniteNumber(r.pm02);
    if (lat == null || lon == null || pm25 == null) continue;
    if (lat < CO_BBOX.south || lat > CO_BBOX.north || lon < CO_BBOX.west || lon > CO_BBOX.east) {
      continue;
    }
    const name =
      String(r.publicLocationName || r.locationName || r.publicPlaceName || '').trim() ||
      'AirGradient';
    out.push({
      lat,
      lon,
      name,
      pm25,
      humidity: toFiniteNumber(r.rhum),
      temperature_c: toFiniteNumber(r.atmp),
    });
  }
  return out;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 */
export async function fetchAirGradient(locations) {
  const bySlug = new Map();
  let calls = 0;

  try {
    calls += 1;
    const raw = await fetchJson(WORLD_URL, { timeoutMs: 60_000, retries: 2 });
    const sensors = filterCoAirGradientSensors(raw);
    if (sensors.length === 0) {
      return {
        status: 'error',
        bySlug,
        calls,
        error: 'no online AirGradient sensors with PM2.5 in Colorado',
      };
    }

    for (const loc of locations) {
      let near = nearestPoints(loc, sensors, MAX_SENSORS).filter(
        (n) => n.distanceKm <= PREFERRED_MAX_KM,
      );
      if (near.length < 2) {
        near = nearestPoints(loc, sensors, MAX_SENSORS).filter(
          (n) => n.distanceKm <= FALLBACK_MAX_KM,
        );
      }
      const consensus = airGradientConsensus(
        near.map((n) => ({
          name: /** @type {string} */ (n.point.name),
          distanceKm: n.distanceKm,
          pm25: /** @type {number | null} */ (n.point.pm25),
        })),
      );
      if (!consensus) continue;

      const nearest = near[0]?.point;
      const tempC = nearest?.temperature_c;
      bySlug.set(loc.slug, {
        ...consensus,
        humidity: nearest?.humidity ?? null,
        temperature_f:
          tempC != null && Number.isFinite(tempC) ? Math.round((tempC * 9) / 5 + 32) : null,
      });
    }

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
      ...(bySlug.size === 0 ? { error: 'no AirGradient sensors matched catalog locations' } : {}),
    };
  } catch (err) {
    return {
      status: 'error',
      bySlug,
      error: err instanceof Error ? err.message : String(err),
      calls,
    };
  }
}

/**
 * EPA PM2.5 → AQI (NowCast-style breakpoints).
 * @param {number|null} pm
 * @returns {number|null}
 */
export function pm25ToAqi(pm) {
  if (pm == null || !Number.isFinite(pm)) return null;
  const breakpoints = [
    [0, 12, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 500.4, 301, 500],
  ];
  for (const [cLow, cHigh, aLow, aHigh] of breakpoints) {
    if (pm >= cLow && pm <= cHigh) {
      return Math.round(((aHigh - aLow) / (cHigh - cLow)) * (pm - cLow) + aLow);
    }
  }
  return 500;
}
