/**
 * Open-Meteo forecast adapter — bulk current/hourly/daily for CO locations.
 * Failure point: API timeout / 429 / weight limits.
 * Fallback: return status error/partial; other adapters still run.
 * NBM thunderstorm % is a second call; if it fails, forecast still publishes without lightning series.
 */

import { buildAstronomy } from '../../lib/astronomy.js';
import { fetchJson } from '../../lib/http.js';
import { estimateRfComms } from '../../lib/rf-comms.js';
import { wmoLabel } from '../../lib/wmo.js';

export { wmoLabel };

const CHUNK = 20;
const CHUNK_DELAY_MS = 10_000;
const RETRY_BACKOFF_MS = 65_000;
const RETRY_CHUNK = 15;

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('../../lib/types.js').Location[]} chunk
 */
function buildUrl(chunk) {
  const lats = chunk.map((l) => l.lat).join(',');
  const lons = chunk.map((l) => l.lon).join(',');
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,pressure_msl,surface_pressure,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,uv_index,dewpoint_2m,visibility` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,relative_humidity_2m,dewpoint_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,uv_index,soil_temperature_6cm,soil_moisture_3_to_9cm,cape,shortwave_radiation,freezing_level_height,is_day,pressure_msl,temperature_850hPa` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,precipitation_hours,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset,sunshine_duration,daylight_duration,shortwave_radiation_sum,et0_fao_evapotranspiration,relative_humidity_2m_max,relative_humidity_2m_min,dewpoint_2m_max,dewpoint_2m_min,cloud_cover_mean,visibility_min,cape_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FDenver&forecast_days=10&forecast_hours=48`
  );
}

/**
 * Slice an hourly array to 48 entries (or empty if missing).
 * @param {unknown} arr
 * @returns {unknown[]}
 */
function sliceHourly(arr) {
  return Array.isArray(arr) ? arr.slice(0, 48) : [];
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
    `&timezone=America%2FDenver&forecast_days=10`
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
 * Sum hourly precipitation from America/Denver local midnight through the nearest hour ≤ now.
 * @param {string[]} times
 * @param {(number | null | undefined)[]} precip
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function precipTodayInches(times, precip, nowMs = Date.now()) {
  if (!Array.isArray(times) || !Array.isArray(precip) || times.length === 0) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const today = `${map.year}-${map.month}-${map.day}`;
  const hourKey = fmtHourKey(nowMs);
  let sum = 0;
  let any = false;
  for (let i = 0; i < times.length; i += 1) {
    const t = String(times[i]);
    if (!t.startsWith(today)) continue;
    // Local ISO without offset from Open-Meteo (America/Denver)
    if (t.slice(0, 13) > hourKey) continue;
    const v = precip[i];
    if (v == null || Number.isNaN(Number(v))) continue;
    sum += Number(v);
    any = true;
  }
  return any ? Math.round(sum * 1000) / 1000 : null;
}

/**
 * @param {number} nowMs
 * @returns {string} YYYY-MM-DDTHH in Denver
 */
function fmtHourKey(nowMs) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = f.formatToParts(new Date(nowMs));
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}T${map.hour}`;
}

/**
 * @param {any} r
 * @param {string} condition
 */
export function mapResult(r, condition) {
  const cur = r.current;
  const hourlyTimes = r.hourly?.time ? sliceHourly(r.hourly.time) : [];
  const hourlyPrecip = r.hourly?.precipitation ? sliceHourly(r.hourly.precipitation) : [];
  const precipToday = precipTodayInches(
    /** @type {string[]} */ (hourlyTimes),
    /** @type {(number | null)[]} */ (hourlyPrecip),
  );
  return {
    current: {
      temp_f: cur.temperature_2m,
      feels_like_f: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      dewpoint_f: cur.dewpoint_2m ?? null,
      weather_code: cur.weather_code,
      condition,
      cloud_cover: cur.cloud_cover,
      pressure_mb: cur.pressure_msl,
      surface_pressure_mb: cur.surface_pressure ?? null,
      is_day: cur.is_day ?? null,
      wind_speed_mph: cur.wind_speed_10m,
      wind_dir_deg: cur.wind_direction_10m,
      wind_gust_mph: cur.wind_gusts_10m,
      precip_in: cur.precipitation,
      precip_today_in: precipToday,
      visibility_m: cur.visibility ?? null,
      uv_index: cur.uv_index ?? null,
      thunderstorm_probability: null,
    },
    hourly: r.hourly
      ? {
          time: sliceHourly(r.hourly.time),
          temperature_2m: sliceHourly(r.hourly.temperature_2m),
          apparent_temperature: sliceHourly(r.hourly.apparent_temperature),
          precipitation_probability: sliceHourly(r.hourly.precipitation_probability),
          precipitation: sliceHourly(r.hourly.precipitation),
          rain: sliceHourly(r.hourly.rain),
          showers: sliceHourly(r.hourly.showers),
          snowfall: sliceHourly(r.hourly.snowfall),
          weather_code: sliceHourly(r.hourly.weather_code),
          wind_speed_10m: sliceHourly(r.hourly.wind_speed_10m),
          wind_direction_10m: sliceHourly(r.hourly.wind_direction_10m),
          wind_gusts_10m: sliceHourly(r.hourly.wind_gusts_10m),
          wind_speed_80m: sliceHourly(r.hourly.wind_speed_80m),
          wind_direction_80m: sliceHourly(r.hourly.wind_direction_80m),
          relative_humidity_2m: sliceHourly(r.hourly.relative_humidity_2m),
          dewpoint_2m: sliceHourly(r.hourly.dewpoint_2m),
          cloud_cover: sliceHourly(r.hourly.cloud_cover),
          cloud_cover_low: sliceHourly(r.hourly.cloud_cover_low),
          cloud_cover_mid: sliceHourly(r.hourly.cloud_cover_mid),
          cloud_cover_high: sliceHourly(r.hourly.cloud_cover_high),
          visibility: sliceHourly(r.hourly.visibility),
          uv_index: sliceHourly(r.hourly.uv_index),
          soil_temperature_6cm: sliceHourly(r.hourly.soil_temperature_6cm),
          soil_moisture_3_to_9cm: sliceHourly(r.hourly.soil_moisture_3_to_9cm),
          cape: sliceHourly(r.hourly.cape),
          shortwave_radiation: sliceHourly(r.hourly.shortwave_radiation),
          freezing_level_height: sliceHourly(r.hourly.freezing_level_height),
          is_day: sliceHourly(r.hourly.is_day),
          pressure_msl: sliceHourly(r.hourly.pressure_msl),
          temperature_850hPa: sliceHourly(r.hourly.temperature_850hPa),
          thunderstorm_probability: [],
        }
      : null,
    daily: r.daily
      ? {
          time: r.daily.time ?? [],
          weather_code: r.daily.weather_code ?? [],
          temperature_2m_max: r.daily.temperature_2m_max ?? [],
          temperature_2m_min: r.daily.temperature_2m_min ?? [],
          apparent_temperature_max: r.daily.apparent_temperature_max ?? [],
          apparent_temperature_min: r.daily.apparent_temperature_min ?? [],
          precipitation_sum: r.daily.precipitation_sum ?? [],
          precipitation_probability_max: r.daily.precipitation_probability_max ?? [],
          precipitation_hours: r.daily.precipitation_hours ?? [],
          snowfall_sum: r.daily.snowfall_sum ?? [],
          wind_speed_10m_max: r.daily.wind_speed_10m_max ?? [],
          wind_gusts_10m_max: r.daily.wind_gusts_10m_max ?? [],
          wind_direction_10m_dominant: r.daily.wind_direction_10m_dominant ?? [],
          uv_index_max: r.daily.uv_index_max ?? [],
          sunrise: r.daily.sunrise ?? [],
          sunset: r.daily.sunset ?? [],
          sunshine_duration: r.daily.sunshine_duration ?? [],
          daylight_duration: r.daily.daylight_duration ?? [],
          shortwave_radiation_sum: r.daily.shortwave_radiation_sum ?? [],
          et0_fao_evapotranspiration: r.daily.et0_fao_evapotranspiration ?? [],
          relative_humidity_2m_max: r.daily.relative_humidity_2m_max ?? [],
          relative_humidity_2m_min: r.daily.relative_humidity_2m_min ?? [],
          dewpoint_2m_max: r.daily.dewpoint_2m_max ?? [],
          dewpoint_2m_min: r.daily.dewpoint_2m_min ?? [],
          cloud_cover_mean: r.daily.cloud_cover_mean ?? [],
          visibility_min: r.daily.visibility_min ?? [],
          cape_max: r.daily.cape_max ?? [],
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
    // Prefer full NBM hourly series so Day 3–10 get thunderstorm maxima, not only the 48h forecast slice.
    payload.daily.thunderstorm_probability_max = dailyMaxThunderstorm(
      nbmHourly.time,
      nbmHourly.thunderstorm_probability,
      payload.daily.time,
    );
  }
}

/**
 * Attach model-derived RF ducting estimate. Mutates payload.
 * @param {ReturnType<typeof mapResult>} payload
 * @param {number | null | undefined} elevationFt
 */
export function attachRfComms(payload, elevationFt) {
  const times = payload.hourly?.time ?? [];
  const series = payload.hourly?.temperature_850hPa ?? [];
  let t850 = null;
  if (times.length && series.length) {
    const now = Date.now();
    let best = 0;
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const diff = Math.abs(new Date(String(t)).getTime() - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    const v = series[best];
    t850 = v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }
  payload.rf_comms = estimateRfComms(payload.current ?? {}, t850, elevationFt);
}

/**
 * Attach computed astronomy for the location. Mutates payload.
 * @param {ReturnType<typeof mapResult> & { astronomy?: unknown }} payload
 * @param {number} lat
 * @param {number} lon
 * @param {Date} [now]
 */
export function attachAstronomy(payload, lat, lon, now = new Date()) {
  payload.astronomy = buildAstronomy(lat, lon, now);
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
        const mapped = mapResult(r, wmoLabel(r.current.weather_code));
        attachRfComms(mapped, loc.elevation_ft);
        attachAstronomy(mapped, loc.lat, loc.lon);
        bySlug.set(loc.slug, mapped);
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
          const mapped = mapResult(r, wmoLabel(r.current.weather_code));
          attachRfComms(mapped, loc.elevation_ft);
          attachAstronomy(mapped, loc.lat, loc.lon);
          bySlug.set(loc.slug, mapped);
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
