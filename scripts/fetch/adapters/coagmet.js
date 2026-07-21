/**
 * CoAgMET latest observations (CSU).
 * Failure point: API down / schema drift.
 * Fallback: skip ag fields; status error.
 */

import { fetchJson } from '../../lib/http.js';
import { assignNearestWithin, roundKm } from '../../lib/geo.js';
import { toFiniteNumber } from '../../lib/parse.js';

/**
 * Map a CoAgMET latest-obs record onto normalized field names (alias-tolerant).
 * @param {Record<string, unknown>} obs
 * @returns {{
 *   st5: number | null,
 *   st15: number | null,
 *   sm5: number | null,
 *   sm15: number | null,
 *   precip: number | null,
 *   eto: number | null,
 *   vp: number | null,
 *   sr: number | null,
 *   ws: number | null,
 *   tmean: number | null,
 *   rh: number | null,
 * }}
 */
export function mapCoagmetObs(obs) {
  return {
    st5: toFiniteNumber(obs.st5cm ?? obs.soilTemp5 ?? obs.st5 ?? obs.soil_temp_5),
    st15: toFiniteNumber(obs.st15cm ?? obs.soilTemp15 ?? obs.st15 ?? obs.soil_temp_15),
    sm5: toFiniteNumber(
      obs.sm5cm ?? obs.soilMoisture5 ?? obs.vwc5 ?? obs.swc5 ?? obs.soil_moisture_5,
    ),
    sm15: toFiniteNumber(
      obs.sm15cm ?? obs.soilMoisture15 ?? obs.vwc15 ?? obs.swc15 ?? obs.soil_moisture_15,
    ),
    precip: toFiniteNumber(obs.precip ?? obs.precipitation ?? obs.rain ?? obs.precip_daily),
    eto: toFiniteNumber(obs.eto ?? obs.et0 ?? obs.refET ?? obs.et_os),
    vp: toFiniteNumber(obs.vaporPressure ?? obs.vp ?? obs.vpd ?? obs.vapor_pressure),
    sr: toFiniteNumber(obs.solarRad ?? obs.sr ?? obs.solar),
    ws: toFiniteNumber(obs.windSpeed ?? obs.ws ?? obs.wind),
    tmean: toFiniteNumber(obs.t ?? obs.temp ?? obs.airtemp),
    rh: toFiniteNumber(obs.rh ?? obs.humidity),
  };
}

/**
 * Join metadata + latest JSON into station rows for nearest assignment.
 * @param {Record<string, unknown>} meta
 * @param {Record<string, unknown>} latest
 * @returns {object[]}
 */
export function parseCoagmetStations(meta, latest) {
  const stations = [];
  for (const [id, info] of Object.entries(meta)) {
    if (!info || typeof info !== 'object') continue;
    const rec = /** @type {Record<string, unknown>} */ (info);
    const lat = Number(rec.lat);
    const lon = Number(rec.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (rec.active && String(rec.active).toLowerCase() !== 'active') continue;
    const obs = latest[id];
    if (!obs || typeof obs !== 'object') continue;
    stations.push({
      id,
      name: String(rec.name ?? id),
      lat,
      lon,
      ...mapCoagmetObs(/** @type {Record<string, unknown>} */ (obs)),
    });
  }
  return stations;
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @returns {Promise<{ status: string, bySlug: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchCoagmet(locations) {
  const bySlug = new Map();
  let calls = 0;

  try {
    calls += 1;
    const meta = await fetchJson('https://coagmet.colostate.edu/data/metadata.json', {
      timeoutMs: 45_000,
    });
    calls += 1;
    const latest = await fetchJson('https://coagmet.colostate.edu/data/latest.json', {
      timeoutMs: 45_000,
    });

    const stations = parseCoagmetStations(
      /** @type {Record<string, unknown>} */ (meta),
      /** @type {Record<string, unknown>} */ (latest),
    );

    if (stations.length === 0) {
      return { status: 'error', bySlug, error: 'no CoAgMET stations parsed', calls };
    }

    const assigned = assignNearestWithin(locations, stations, 40, (nearest) => {
      const s = nearest.point;
      return {
        station_id: s.id,
        station_name: s.name,
        distance_km: roundKm(nearest.distanceKm),
        soil_temp_5cm_f: s.st5,
        soil_temp_15cm_f: s.st15,
        soil_moisture_5cm: s.sm5,
        soil_moisture_15cm: s.sm15,
        precip_in: s.precip,
        eto_in: s.eto,
        vapor_pressure: s.vp,
        solar_radiation: s.sr,
        wind_speed_mph: s.ws,
        air_temp_f: s.tmean,
        relative_humidity: s.rh,
        url: `https://coagmet.colostate.edu/station/${encodeURIComponent(s.id)}`,
      };
    });
    for (const [slug, row] of assigned) bySlug.set(slug, row);

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
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
