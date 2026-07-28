/**
 * PurpleAir CO bounding-box sensors → outdoor multi-sensor consensus per location.
 * Failure point: missing key, point exhaustion, HTTP errors.
 * Fallback: status skipped/error; UI uses offsite links.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoints, roundKm } from '../../lib/geo.js';
import { CO_BBOX } from '../../lib/colorado.js';
import { toFiniteNumber } from '../../lib/parse.js';

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
 * Quartile helpers on a sorted copy.
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
    // Fall back to Tukey fences when MAD is 0 (many identical readings).
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
 * @typedef {{ name: string, distance_km: number, pm25: number }} PurpleAirSensorSample
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
 *   sensors: PurpleAirSensorSample[],
 * } | null}
 */
export function purpleAirConsensus(sensorsNear) {
  if (!Array.isArray(sensorsNear) || sensorsNear.length === 0) return null;

  /** @type {{ name: string, distanceKm: number, pm25: number }[]} */
  let usable = [];
  for (const s of sensorsNear) {
    const pm = toFiniteNumber(s.pm25);
    if (pm == null) continue;
    usable.push({
      name: String(s.name ?? 'PurpleAir'),
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

  const nearestName = sensors[0]?.name ?? 'PurpleAir';
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
    url: 'https://map.purpleair.com/',
    sensors,
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{ PURPLEAIR_API_KEY?: string }} env
 */
export async function fetchPurpleAir(locations, env = process.env) {
  const bySlug = new Map();
  let calls = 0;
  const key = env.PURPLEAIR_API_KEY;
  if (!key) {
    return { status: 'skipped', bySlug, calls, error: 'PURPLEAIR_API_KEY not set' };
  }

  try {
    calls += 1;
    const fields = 'name,latitude,longitude,pm2.5_10minute,humidity,temperature,location_type';
    const url =
      `https://api.purpleair.com/v1/sensors?fields=${encodeURIComponent(fields)}` +
      `&nwlat=${CO_BBOX.north}&selat=${CO_BBOX.south}&nwlng=${CO_BBOX.west}&selng=${CO_BBOX.east}&max_age=3600`;

    const data = await fetchJson(url, {
      headers: { 'X-API-Key': key },
      timeoutMs: 60_000,
    });

    const fieldNames = data?.fields ?? [];
    const rows = data?.data ?? [];
    const sensors = rows
      .map((row) => {
        const obj = {};
        for (let i = 0; i < fieldNames.length; i += 1) {
          obj[fieldNames[i]] = row[i];
        }
        const lat = toFiniteNumber(obj.latitude);
        const lon = toFiniteNumber(obj.longitude);
        if (lat == null || lon == null) return null;
        // 0 = outdoor, 1 = indoor
        const locationType = toFiniteNumber(obj.location_type);
        if (locationType != null && locationType !== 0) return null;
        return {
          lat,
          lon,
          name: obj.name ?? 'PurpleAir',
          pm25: toFiniteNumber(obj['pm2.5_10minute']),
          humidity: toFiniteNumber(obj.humidity),
          temperature_f: toFiniteNumber(obj.temperature),
        };
      })
      .filter(Boolean);

    for (const loc of locations) {
      let near = nearestPoints(loc, sensors, MAX_SENSORS).filter(
        (n) => n.distanceKm <= PREFERRED_MAX_KM,
      );
      if (near.length < 2) {
        near = nearestPoints(loc, sensors, MAX_SENSORS).filter(
          (n) => n.distanceKm <= FALLBACK_MAX_KM,
        );
      }
      const consensus = purpleAirConsensus(
        near.map((n) => ({
          name: /** @type {string} */ (n.point.name),
          distanceKm: n.distanceKm,
          pm25: /** @type {number | null} */ (n.point.pm25),
        })),
      );
      if (!consensus) continue;

      // Attach humidity/temp from the nearest sensor used in consensus (informational).
      const nearest = near[0]?.point;
      bySlug.set(loc.slug, {
        ...consensus,
        humidity: nearest?.humidity ?? null,
        temperature_f: nearest?.temperature_f ?? null,
      });
    }

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
      ...(bySlug.size === 0 ? { error: 'no PurpleAir sensors matched catalog locations' } : {}),
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
