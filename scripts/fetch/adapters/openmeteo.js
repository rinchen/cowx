/**
 * Open-Meteo forecast adapter — bulk current/hourly/daily for CO locations.
 * Failure point: API timeout / 429 / weight limits.
 * Fallback: return status error/partial; other adapters still run.
 * NBM thunderstorm % is a second call; if it fails, forecast still publishes without lightning series.
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
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,dewpoint_2m,cloud_cover,visibility,uv_index` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FDenver&forecast_days=10&forecast_hours=48`
  );
}

/**
 * NOAA NBM thunderstorm probability only (CONUS). Failure is non-fatal.
 * @param {import('../../lib/types.js').Location[]} chunk
 */
function buildNbmThunderstormUrl(chunk) {
  const lats = chunk.map((l) => l.lat).join(',');
  const lons = chunk.map((l) => l.lon).join(',');
  return (
    `https://api.open-meteo.com/v1/gfs?latitude=${lats}&longitude=${lons}` +
    `&hourly=thunderstorm_probability` +
    `&models=ncep_nbm_conus` +
    `&timezone=America%2FDenver&forecast_days=10&forecast_hours=48`
  );
}

/**
 * Align NBM thunderstorm % onto forecast hourly timestamps.
 * @param {string[]} forecastTimes
 * @param {string[] | undefined} nbmTimes
 * @param {(number | null)[] | undefined} nbmPct
 * @returns {(number | null)[]}
 */
export function alignThunderstormByTime(forecastTimes, nbmTimes, nbmPct) {
  /** @type {Map<string, number | null>} */
  const byTime = new Map();
  if (Array.isArray(nbmTimes) && Array.isArray(nbmPct)) {
    for (let i = 0; i < nbmTimes.length; i += 1) {
      byTime.set(nbmTimes[i], nbmPct[i] ?? null);
    }
  }
  return forecastTimes.map((t) => (byTime.has(t) ? (byTime.get(t) ?? null) : null));
}

/**
 * Max thunderstorm % per calendar day from hourly series.
 * @param {string[]} hourTimes
 * @param {(number | null)[]} hourPct
 * @param {string[]} dayTimes
 * @returns {(number | null)[]}
 */
export function dailyMaxThunderstorm(hourTimes, hourPct, dayTimes) {
  /** @type {Map<string, number>} */
  const maxByDay = new Map();
  for (let i = 0; i < hourTimes.length; i += 1) {
    const day = String(hourTimes[i]).slice(0, 10);
    const v = hourPct[i];
    if (v == null || Number.isNaN(Number(v))) continue;
    const n = Number(v);
    const prev = maxByDay.get(day);
    if (prev == null || n > prev) maxByDay.set(day, n);
  }
  return dayTimes.map((d) => {
    const key = String(d).slice(0, 10);
    return maxByDay.has(key) ? (maxByDay.get(key) ?? null) : null;
  });
}

/**
 * Nearest hourly thunderstorm % to now (or to `nowMs` for tests).
 * @param {string[]} times
 * @param {(number | null)[]} pct
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function nearestThunderstormPct(times, pct, nowMs = Date.now()) {
  if (!times.length) return null;
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - nowMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  const v = pct[best];
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
}

/**
 * @param {any} r
 * @param {string} condition
 */
export function mapResult(r, condition) {
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
      thunderstorm_probability: null,
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
          wind_direction_10m: r.hourly.wind_direction_10m?.slice(0, 48) ?? [],
          wind_gusts_10m: r.hourly.wind_gusts_10m?.slice(0, 48) ?? [],
          relative_humidity_2m: r.hourly.relative_humidity_2m?.slice(0, 48) ?? [],
          dewpoint_2m: r.hourly.dewpoint_2m?.slice(0, 48) ?? [],
          cloud_cover: r.hourly.cloud_cover?.slice(0, 48) ?? [],
          visibility: r.hourly.visibility?.slice(0, 48) ?? [],
          uv_index: r.hourly.uv_index?.slice(0, 48) ?? [],
          thunderstorm_probability: [],
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
          wind_direction_10m_dominant: r.daily.wind_direction_10m_dominant ?? [],
          uv_index_max: r.daily.uv_index_max ?? [],
          sunrise: r.daily.sunrise ?? [],
          sunset: r.daily.sunset ?? [],
          thunderstorm_probability_max: [],
        }
      : null,
  };
}

/**
 * Merge NBM thunderstorm series into a mapped payload. Mutates `payload`.
 * @param {ReturnType<typeof mapResult>} payload
 * @param {{ time?: string[], thunderstorm_probability?: (number | null)[] } | null | undefined} nbmHourly
 */
export function mergeThunderstormProbability(payload, nbmHourly) {
  if (!payload.hourly || !nbmHourly?.time || !nbmHourly.thunderstorm_probability) return;
  const aligned = alignThunderstormByTime(
    payload.hourly.time,
    nbmHourly.time,
    nbmHourly.thunderstorm_probability,
  );
  payload.hourly.thunderstorm_probability = aligned;
  payload.current.thunderstorm_probability = nearestThunderstormPct(payload.hourly.time, aligned);
  if (payload.daily?.time) {
    payload.daily.thunderstorm_probability_max = dailyMaxThunderstorm(
      payload.hourly.time,
      aligned,
      payload.daily.time,
    );
  }
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 * @param {Map<string, object>} bySlug
 * @param {string[]} errors
 * @returns {Promise<number>} calls made
 */
async function fetchAndMergeNbm(chunk, bySlug, errors) {
  try {
    const data = await fetchJson(buildNbmThunderstormUrl(chunk), { timeoutMs: 90_000 });
    const results = Array.isArray(data) ? data : [data];
    for (let j = 0; j < chunk.length; j += 1) {
      const loc = chunk[j];
      const payload = bySlug.get(loc.slug);
      if (!payload) continue;
      const r = results[j];
      mergeThunderstormProbability(
        /** @type {ReturnType<typeof mapResult>} */ (payload),
        r?.hourly ?? null,
      );
    }
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`nbm thunderstorm: ${msg}`);
    console.warn(`openmeteo: NBM thunderstorm fetch failed — ${msg}`);
    if (msg.includes('429')) {
      await sleep(RETRY_BACKOFF_MS);
    }
    return 1;
  }
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
      calls += await fetchAndMergeNbm(chunk, bySlug, errors);
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
        calls += await fetchAndMergeNbm(chunk, bySlug, errors);
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
