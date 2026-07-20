/**
 * Optional Synoptic / MesoWest latest observations (token required).
 * Failure point: missing token / API error / rate limit.
 * Fallback: status skipped; CWOP remains primary PWS.
 */

import { fetchJson } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

const LATEST_URL = 'https://api.synopticdata.com/v2/stations/latest';
/** Rough Colorado bbox */
const CO_BBOX = { west: -109.2, south: 36.9, east: -102.0, north: 41.1 };
const MAX_DISTANCE_KM = 60;
const WITHIN_MINUTES = 120;

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map Synoptic latest JSON → station list.
 * @param {unknown} raw
 */
export function parseSynopticLatest(raw) {
  const stations = raw && typeof raw === 'object' && Array.isArray(raw.STATION) ? raw.STATION : [];
  const out = [];
  for (const s of stations) {
    if (!s || typeof s !== 'object') continue;
    const lat = num(s.LATITUDE);
    const lon = num(s.LONGITUDE);
    if (lat == null || lon == null) continue;
    if (lat < CO_BBOX.south || lat > CO_BBOX.north || lon < CO_BBOX.west || lon > CO_BBOX.east) {
      continue;
    }
    const obs = s.OBSERVATIONS ?? {};
    const air = obs.air_temp_value_1;
    const rh = obs.relative_humidity_value_1;
    const wind = obs.wind_speed_value_1;
    const gust = obs.wind_gust_value_1;
    const dir = obs.wind_direction_value_1;
    const press = obs.pressure_value_1 ?? obs.sea_level_pressure_value_1;
    const stid = String(s.STID ?? '');
    if (!stid) continue;

    // Synoptic air_temp is typically Celsius for metric — API default units=english → °F
    out.push({
      callsign: stid,
      name: String(s.NAME ?? stid),
      network: String(s.SHORTNAME ?? s.MNET_ID ?? 'Synoptic'),
      lat,
      lon,
      temp_f: num(air?.value),
      humidity: num(rh?.value),
      wind_speed_mph: num(wind?.value),
      wind_gust_mph: num(gust?.value),
      wind_dir_deg: num(dir?.value),
      pressure_mb: num(press?.value),
      observed: air?.date_time
        ? String(air.date_time)
        : s.OBSERVATION_TIME
          ? String(s.OBSERVATION_TIME)
          : null,
    });
  }
  return out;
}

/**
 * Prefer Synoptic when closer or fresher than existing CWOP primary.
 * @param {object | null} existingPws
 * @param {ReturnType<typeof parseSynopticLatest>[0] & { distance_km: number }} syn
 */
export function mergeSynopticIntoPws(existingPws, syn) {
  const synPrimary = {
    callsign: syn.callsign,
    network: `Synoptic/${syn.network}`,
    lat: syn.lat,
    lon: syn.lon,
    temp_f: syn.temp_f,
    humidity: syn.humidity,
    pressure_mb: syn.pressure_mb,
    wind_speed_mph: syn.wind_speed_mph,
    wind_gust_mph: syn.wind_gust_mph,
    wind_dir_deg: syn.wind_dir_deg,
    observed: syn.observed,
    distance_km: syn.distance_km,
  };

  if (!existingPws || !existingPws.primary) {
    return {
      primary: synPrimary,
      nearby: existingPws?.nearby ?? [],
      links: {
        aprs: existingPws?.links?.aprs ?? null,
        wunderground: existingPws?.links?.wunderground ?? null,
        synoptic: `https://synopticdata.com/`,
      },
    };
  }

  const cwopDist = Number(existingPws.primary.distance_km ?? 999);
  const useSyn = syn.distance_km + 0.5 < cwopDist || existingPws.primary.temp_f == null;

  if (!useSyn) {
    return {
      ...existingPws,
      links: {
        ...existingPws.links,
        synoptic: `https://synopticdata.com/`,
      },
    };
  }

  const nearby = [
    {
      ...existingPws.primary,
    },
    ...(existingPws.nearby ?? []),
  ].slice(0, 1);

  return {
    primary: synPrimary,
    nearby,
    links: {
      aprs: existingPws.links?.aprs ?? null,
      wunderground: existingPws.links?.wunderground ?? null,
      synoptic: `https://synopticdata.com/`,
    },
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Map<string, object | null>} [existingPwsBySlug] — from CWOP
 */
export async function fetchSynoptic(locations, env = process.env, existingPwsBySlug = new Map()) {
  /** @type {Map<string, object | null>} */
  const bySlug = new Map();
  let calls = 0;
  const token = env.SYNOPTIC_API_TOKEN;
  if (!token) {
    return {
      status: 'skipped',
      bySlug,
      calls,
      error: 'SYNOPTIC_API_TOKEN not set',
    };
  }

  try {
    const params = new URLSearchParams({
      token: String(token),
      bbox: `${CO_BBOX.west},${CO_BBOX.south},${CO_BBOX.east},${CO_BBOX.north}`,
      within: String(WITHIN_MINUTES),
      units: 'english',
      status: 'active',
      showemptystations: '0',
    });
    const url = `${LATEST_URL}?${params}`;
    const raw = await fetchJson(url, { timeoutMs: 60_000 });
    calls += 1;

    const summary = raw?.SUMMARY;
    if (summary?.RESPONSE_CODE != null && Number(summary.RESPONSE_CODE) !== 1) {
      return {
        status: 'error',
        bySlug,
        calls,
        error: String(summary.RESPONSE_MESSAGE ?? 'Synoptic API error').slice(0, 500),
      };
    }

    const stations = parseSynopticLatest(raw);
    if (stations.length === 0) {
      return {
        status: 'partial',
        bySlug,
        calls,
        error: 'no Synoptic stations in Colorado bbox',
      };
    }

    let matched = 0;
    for (const loc of locations) {
      const hit = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
      const existing = existingPwsBySlug.get(loc.slug) ?? null;
      if (!hit || hit.distanceKm > MAX_DISTANCE_KM) {
        bySlug.set(loc.slug, existing);
        continue;
      }
      matched += 1;
      const p = /** @type {ReturnType<typeof parseSynopticLatest>[0]} */ (hit.point);
      const syn = { ...p, distance_km: Math.round(hit.distanceKm * 10) / 10 };
      bySlug.set(loc.slug, mergeSynopticIntoPws(existing, syn));
    }

    return {
      status: matched > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
    };
  } catch (err) {
    return {
      status: 'error',
      bySlug,
      calls,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }
}
