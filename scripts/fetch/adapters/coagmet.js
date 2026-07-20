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
        st5: num(obs.st5cm ?? obs.soilTemp5 ?? obs.st5 ?? obs.soil_temp_5),
        st15: num(obs.st15cm ?? obs.soilTemp15 ?? obs.st15 ?? obs.soil_temp_15),
        sm5: num(obs.sm5cm ?? obs.soilMoisture5 ?? obs.vwc5 ?? obs.swc5 ?? obs.soil_moisture_5),
        sm15: num(
          obs.sm15cm ?? obs.soilMoisture15 ?? obs.vwc15 ?? obs.swc15 ?? obs.soil_moisture_15,
        ),
        precip: num(obs.precip ?? obs.precipitation ?? obs.rain ?? obs.precip_daily),
        eto: num(obs.eto ?? obs.et0 ?? obs.refET ?? obs.et_os),
        vp: num(obs.vaporPressure ?? obs.vp ?? obs.vpd ?? obs.vapor_pressure),
        sr: num(obs.solarRad ?? obs.sr ?? obs.solar),
        ws: num(obs.windSpeed ?? obs.ws ?? obs.wind),
        tmean: num(obs.t ?? obs.temp ?? obs.airtemp),
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
