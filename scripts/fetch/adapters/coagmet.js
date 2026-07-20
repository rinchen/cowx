/**
 * CoAgMET latest observations (CSU).
 * Failure point: API down / schema drift.
 * Fallback: skip ag fields; status error.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

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

    const stations = [];
    for (const [id, info] of Object.entries(meta)) {
      if (!info || typeof info !== 'object') continue;
      const lat = Number(info.lat);
      const lon = Number(info.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (info.active && String(info.active).toLowerCase() !== 'active') continue;
      const obs = latest[id];
      if (!obs || typeof obs !== 'object') continue;
      stations.push({
        id,
        name: String(info.name ?? id),
        lat,
        lon,
        st5: num(obs.soilTemp5 ?? obs.st5),
        st15: num(obs.soilTemp15 ?? obs.st15),
        eto: num(obs.eto ?? obs.et0),
        vp: num(obs.vaporPressure ?? obs.vp ?? obs.vpd),
        sr: num(obs.solarRad ?? obs.sr),
        ws: num(obs.windSpeed ?? obs.ws),
        tmean: num(obs.t ?? obs.temp),
        rh: num(obs.rh ?? obs.humidity),
      });
    }

    if (stations.length === 0) {
      return { status: 'error', bySlug, error: 'no CoAgMET stations parsed', calls };
    }

    for (const loc of locations) {
      const nearest = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
      if (!nearest || nearest.distanceKm > 40) continue;
      const s = nearest.point;
      bySlug.set(loc.slug, {
        station_id: s.id,
        station_name: s.name,
        distance_km: Math.round(nearest.distanceKm * 10) / 10,
        soil_temp_5cm_f: s.st5,
        soil_temp_15cm_f: s.st15,
        eto_in: s.eto,
        vapor_pressure: s.vp,
        solar_radiation: s.sr,
        wind_speed_mph: s.ws,
        air_temp_f: s.tmean,
        relative_humidity: s.rh,
        url: `https://coagmet.colostate.edu/station/${encodeURIComponent(s.id)}`,
      });
    }

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

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
