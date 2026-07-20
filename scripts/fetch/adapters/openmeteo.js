/**
 * Open-Meteo forecast adapter — bulk current/hourly/daily for CO locations.
 * Failure point: API timeout / 429 / weight limits.
 * Fallback: return status error/partial; other adapters still run.
 */

import { fetchJson } from '../../lib/http.js';

const CHUNK = 20;
const CHUNK_DELAY_MS = 10_000;
const RETRY_BACKOFF_MS = 65_000;
const RETRY_CHUNK = 15;

const WMO = {
  0: 'Clear',
  1: 'Mostly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing Rime Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Dense Drizzle',
  61: 'Slight Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  71: 'Slight Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Violent Rain Showers',
  85: 'Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Hail',
  99: 'Thunderstorm with Hail',
};

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} code
 * @returns {string}
 */
export function wmoLabel(code) {
  return WMO[code] ?? `Code ${code}`;
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 */
function buildUrl(chunk) {
  const lats = chunk.map((l) => l.lat).join(',');
  const lons = chunk.map((l) => l.lon).join(',');
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,uv_index` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,dewpoint_2m,cloud_cover,visibility,uv_index` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FDenver&forecast_days=10&forecast_hours=48`
  );
}

/**
 * @param {any} r
 * @param {string} condition
 */
function mapResult(r, condition) {
  const cur = r.current;
  return {
    current: {
      temp_f: cur.temperature_2m,
      feels_like_f: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      weather_code: cur.weather_code,
      condition,
      cloud_cover: cur.cloud_cover,
      pressure_mb: cur.pressure_msl,
      wind_speed_mph: cur.wind_speed_10m,
      wind_dir_deg: cur.wind_direction_10m,
      wind_gust_mph: cur.wind_gusts_10m,
      precip_in: cur.precipitation,
      uv_index: cur.uv_index ?? null,
    },
    hourly: r.hourly
      ? {
          time: r.hourly.time?.slice(0, 48) ?? [],
          temperature_2m: r.hourly.temperature_2m?.slice(0, 48) ?? [],
          apparent_temperature: r.hourly.apparent_temperature?.slice(0, 48) ?? [],
          precipitation_probability: r.hourly.precipitation_probability?.slice(0, 48) ?? [],
          precipitation: r.hourly.precipitation?.slice(0, 48) ?? [],
          weather_code: r.hourly.weather_code?.slice(0, 48) ?? [],
          wind_speed_10m: r.hourly.wind_speed_10m?.slice(0, 48) ?? [],
          wind_gusts_10m: r.hourly.wind_gusts_10m?.slice(0, 48) ?? [],
          relative_humidity_2m: r.hourly.relative_humidity_2m?.slice(0, 48) ?? [],
          dewpoint_2m: r.hourly.dewpoint_2m?.slice(0, 48) ?? [],
          cloud_cover: r.hourly.cloud_cover?.slice(0, 48) ?? [],
          visibility: r.hourly.visibility?.slice(0, 48) ?? [],
          uv_index: r.hourly.uv_index?.slice(0, 48) ?? [],
        }
      : null,
    daily: r.daily
      ? {
          time: r.daily.time ?? [],
          weather_code: r.daily.weather_code ?? [],
          temperature_2m_max: r.daily.temperature_2m_max ?? [],
          temperature_2m_min: r.daily.temperature_2m_min ?? [],
          precipitation_sum: r.daily.precipitation_sum ?? [],
          precipitation_probability_max: r.daily.precipitation_probability_max ?? [],
          wind_speed_10m_max: r.daily.wind_speed_10m_max ?? [],
          wind_gusts_10m_max: r.daily.wind_gusts_10m_max ?? [],
          uv_index_max: r.daily.uv_index_max ?? [],
          sunrise: r.daily.sunrise ?? [],
          sunset: r.daily.sunset ?? [],
        }
      : null,
  };
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @returns {Promise<{ status: string, bySlug: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchOpenMeteo(locations) {
  const bySlug = new Map();
  let calls = 0;
  const errors = [];

  for (let i = 0; i < locations.length; i += CHUNK) {
    if (i > 0) await sleep(CHUNK_DELAY_MS);
    const chunk = locations.slice(i, i + CHUNK);
    try {
      calls += 1;
      const data = await fetchJson(buildUrl(chunk), { timeoutMs: 90_000 });
      const results = Array.isArray(data) ? data : [data];
      for (let j = 0; j < chunk.length; j += 1) {
        const loc = chunk[j];
        const r = results[j];
        if (!r?.current) continue;
        bySlug.set(loc.slug, mapResult(r, wmoLabel(r.current.weather_code)));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      if (msg.includes('429')) {
        console.warn('openmeteo: 429 — backing off 65s');
        await sleep(RETRY_BACKOFF_MS);
      } else {
        await sleep(5000);
      }
    }
  }

  const missing = locations.filter((l) => !bySlug.has(l.slug));
  if (missing.length > 0) {
    console.warn(`openmeteo: retrying ${missing.length} missing locations after backoff`);
    await sleep(RETRY_BACKOFF_MS);
    for (let i = 0; i < missing.length; i += RETRY_CHUNK) {
      if (i > 0) await sleep(CHUNK_DELAY_MS);
      const chunk = missing.slice(i, i + RETRY_CHUNK);
      try {
        calls += 1;
        const data = await fetchJson(buildUrl(chunk), { timeoutMs: 90_000 });
        const results = Array.isArray(data) ? data : [data];
        for (let j = 0; j < chunk.length; j += 1) {
          const loc = chunk[j];
          const r = results[j];
          if (!r?.current) continue;
          bySlug.set(loc.slug, mapResult(r, wmoLabel(r.current.weather_code)));
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const coverage = bySlug.size / Math.max(locations.length, 1);
  console.log(
    `openmeteo: coverage ${bySlug.size}/${locations.length} (${(coverage * 100).toFixed(1)}%)`,
  );

  if (bySlug.size === 0) {
    return { status: 'error', bySlug, error: errors.join('; ') || 'no data', calls };
  }
  if (errors.length > 0 || coverage < 0.95) {
    return {
      status: 'partial',
      bySlug,
      error: errors.join('; ') || `coverage ${(coverage * 100).toFixed(1)}%`,
      calls,
    };
  }
  return { status: 'ok', bySlug, calls };
}
