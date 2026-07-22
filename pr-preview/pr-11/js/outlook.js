/**
 * Pure helpers for Short-Term Outlook / hourly modal (testable, no DOM).
 */

import { escapeHtml } from './dom.js';
import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { windDirLabel } from './wind.js';

/**
 * @param {string[]} times
 * @param {number} [nowMs]
 * @returns {number}
 */
export function nearestHourIndex(times, nowMs = Date.now()) {
  if (!Array.isArray(times) || times.length === 0) return 0;
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(new Date(t).getTime() - nowMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

/**
 * Sky for "now" from the nearest hourly slot (same clock as Short-Term Outlook).
 * Prefer this over a frozen fetch-time `current` snapshot so the hero/bottom-line
 * stay aligned with the outlook as the wall clock advances between fetches.
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {number} [nowMs]
 * @returns {{ weather_code: number | null, condition: string, is_day: boolean } | null}
 */
export function pickNowSky(hourly, nowMs = Date.now()) {
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  if (!times.length) return null;
  const hi = nearestHourIndex(times, nowMs);
  const weather_code = numOrNull(/** @type {(number | null)[]} */ (hourly?.weather_code ?? [])[hi]);
  const dayFlag = /** @type {(number | null)[]} */ (hourly?.is_day ?? [])[hi];
  const is_day = dayFlag === 0 || dayFlag === 1 ? dayFlag === 1 : true;
  return {
    weather_code,
    condition: wmoLabel(weather_code),
    is_day,
  };
}

/**
 * @typedef {{
 *   index: number,
 *   time: string,
 *   weather_code: number | null,
 *   temp_f: number | null,
 *   feels_like_f: number | null,
 *   precip_pct: number | null,
 *   wind_mph: number | null,
 *   wind_dir_deg: number | null,
 *   gust_mph: number | null,
 *   tstorm_pct: number | null,
 *   is_day: boolean,
 * }} CompactHourRow
 */

/**
 * Next N hours from the nearest hour (inclusive).
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {{ count?: number, nowMs?: number }} [opts]
 * @returns {CompactHourRow[]}
 */
export function sliceCompactHours(hourly, opts = {}) {
  const count = Math.min(12, Math.max(1, opts.count ?? 10));
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  if (!times.length) return [];
  const start = nearestHourIndex(times, opts.nowMs);
  const end = Math.min(times.length, start + count);
  /** @type {CompactHourRow[]} */
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const dayFlag = /** @type {(number | null)[]} */ (hourly?.is_day ?? [])[i];
    const isDay = dayFlag === 0 || dayFlag === 1 ? dayFlag === 1 : true;
    rows.push({
      index: i,
      time: times[i],
      weather_code: numOrNull(/** @type {(number | null)[]} */ (hourly?.weather_code ?? [])[i]),
      temp_f: numOrNull(/** @type {(number | null)[]} */ (hourly?.temperature_2m ?? [])[i]),
      feels_like_f: numOrNull(
        /** @type {(number | null)[]} */ (hourly?.apparent_temperature ?? [])[i],
      ),
      precip_pct: numOrNull(
        /** @type {(number | null)[]} */ (hourly?.precipitation_probability ?? [])[i],
      ),
      wind_mph: numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_speed_10m ?? [])[i]),
      wind_dir_deg: numOrNull(
        /** @type {(number | null)[]} */ (hourly?.wind_direction_10m ?? [])[i],
      ),
      gust_mph: numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_gusts_10m ?? [])[i]),
      tstorm_pct: numOrNull(
        /** @type {(number | null)[]} */ (hourly?.thunderstorm_probability ?? [])[i],
      ),
      is_day: isDay,
    });
  }
  return rows;
}

/**
 * @typedef {{
 *   id: 'today' | 'tonight',
 *   label: string,
 *   weather_code: number | null,
 *   is_day: boolean,
 *   temp_high_f: number | null,
 *   temp_low_f: number | null,
 *   precip_pct_max: number | null,
 *   wind_mph_max: number | null,
 *   tstorm_pct_max: number | null,
 *   summary: string,
 * }} PeriodSummary
 */

/**
 * Synthesize Today / Tonight from hourly + daily sunrise/sunset.
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {Record<string, unknown> | null | undefined} daily
 * @param {{ nowMs?: number }} [opts]
 * @returns {PeriodSummary[]}
 */
export function buildPeriodSummaries(hourly, daily, opts = {}) {
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  if (!times.length) return [];

  const sunrise0 =
    daily?.sunrise != null ? String(/** @type {string[]} */ (daily.sunrise)[0] ?? '') : '';
  const sunset0 =
    daily?.sunset != null ? String(/** @type {string[]} */ (daily.sunset)[0] ?? '') : '';
  const sunrise1 =
    daily?.sunrise != null ? String(/** @type {string[]} */ (daily.sunrise)[1] ?? '') : '';

  const sunrises = /** @type {string[]} */ (daily?.sunrise ?? []);
  const sunsets = /** @type {string[]} */ (daily?.sunset ?? []);

  /** @type {number[]} */
  const todayIdx = [];
  /** @type {number[]} */
  const tonightIdx = [];

  const riseMs = sunrise0 ? new Date(sunrise0).getTime() : NaN;
  const setMs = sunset0 ? new Date(sunset0).getTime() : NaN;
  const nextRiseMs = sunrise1 ? new Date(sunrise1).getTime() : NaN;

  times.forEach((t, i) => {
    const ms = new Date(t).getTime();
    const dayFlag = /** @type {(number | null)[]} */ (hourly?.is_day ?? [])[i];
    let isDay;
    if (dayFlag === 0 || dayFlag === 1) {
      isDay = dayFlag === 1;
    } else if (Number.isFinite(riseMs) && Number.isFinite(setMs)) {
      isDay = ms >= riseMs && ms < setMs;
    } else {
      isDay = isDaytime(t, sunrises, sunsets);
    }

    if (Number.isFinite(riseMs) && Number.isFinite(setMs)) {
      if (ms >= riseMs && ms < setMs) todayIdx.push(i);
      else if (ms >= setMs && (!Number.isFinite(nextRiseMs) || ms < nextRiseMs)) tonightIdx.push(i);
    } else if (isDay) {
      todayIdx.push(i);
    } else {
      tonightIdx.push(i);
    }
  });

  // Prefer remaining hours from now for "today" when we're mid-day
  const nowMs = opts.nowMs ?? Date.now();
  const todayFromNow = todayIdx.filter((i) => new Date(times[i]).getTime() >= nowMs - 30 * 60_000);
  const tonightFromNow = tonightIdx.filter(
    (i) => new Date(times[i]).getTime() >= nowMs - 30 * 60_000,
  );

  /** @type {PeriodSummary[]} */
  const out = [];
  const today = summarizeIndices(hourly, todayFromNow.length ? todayFromNow : todayIdx, {
    id: 'today',
    label: 'Today',
    is_day: true,
    dailyHigh: numOrNull(/** @type {(number | null)[]} */ (daily?.temperature_2m_max ?? [])[0]),
    dailyLow: numOrNull(/** @type {(number | null)[]} */ (daily?.temperature_2m_min ?? [])[0]),
  });
  if (today) out.push(today);

  const tonight = summarizeIndices(hourly, tonightFromNow.length ? tonightFromNow : tonightIdx, {
    id: 'tonight',
    label: 'Tonight',
    is_day: false,
    dailyHigh: null,
    dailyLow: null,
  });
  if (tonight) out.push(tonight);

  return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {number[]} indices
 * @param {{
 *   id: 'today' | 'tonight',
 *   label: string,
 *   is_day: boolean,
 *   dailyHigh: number | null,
 *   dailyLow: number | null,
 * }} meta
 * @returns {PeriodSummary | null}
 */
function summarizeIndices(hourly, indices, meta) {
  if (!indices.length) return null;
  const temps = indices
    .map((i) => numOrNull(/** @type {(number | null)[]} */ (hourly?.temperature_2m ?? [])[i]))
    .filter((v) => v != null);
  const precip = indices
    .map((i) =>
      numOrNull(/** @type {(number | null)[]} */ (hourly?.precipitation_probability ?? [])[i]),
    )
    .filter((v) => v != null);
  const winds = indices
    .map((i) => numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_speed_10m ?? [])[i]))
    .filter((v) => v != null);
  const tstorms = indices
    .map((i) =>
      numOrNull(/** @type {(number | null)[]} */ (hourly?.thunderstorm_probability ?? [])[i]),
    )
    .filter((v) => v != null);
  const codes = indices
    .map((i) => numOrNull(/** @type {(number | null)[]} */ (hourly?.weather_code ?? [])[i]))
    .filter((v) => v != null);

  const tempHigh = temps.length > 0 ? Math.max(.../** @type {number[]} */ (temps)) : meta.dailyHigh;
  const tempLow = temps.length > 0 ? Math.min(.../** @type {number[]} */ (temps)) : meta.dailyLow;
  const precipMax = precip.length ? Math.max(.../** @type {number[]} */ (precip)) : null;
  const windMax = winds.length ? Math.max(.../** @type {number[]} */ (winds)) : null;
  const tstormMax = tstorms.length ? Math.max(.../** @type {number[]} */ (tstorms)) : null;
  const code = modeNumber(/** @type {number[]} */ (codes));

  const bits = [];
  if (tempHigh != null && tempLow != null) {
    bits.push(`${Math.round(tempHigh)}° / ${Math.round(tempLow)}°F`);
  } else if (tempHigh != null) {
    bits.push(`High ${Math.round(tempHigh)}°F`);
  }
  if (precipMax != null) bits.push(`${Math.round(precipMax)}% precip`);
  if (windMax != null) bits.push(`winds to ${Math.round(windMax)} mph`);
  if (tstormMax != null && tstormMax >= 20) bits.push(`${Math.round(tstormMax)}% storms`);
  if (code != null) bits.push(wmoLabel(code));

  return {
    id: meta.id,
    label: meta.label,
    weather_code: code,
    is_day: meta.is_day,
    temp_high_f: tempHigh,
    temp_low_f: tempLow,
    precip_pct_max: precipMax,
    wind_mph_max: windMax,
    tstorm_pct_max: tstormMax,
    summary: bits.join(' · ') || 'Details unavailable',
  };
}

/**
 * @typedef {{ id: string, text: string }} OutlookHighlight
 */

/**
 * Client-derived 24–48h highlight bullets.
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {{ fromIndex?: number, hours?: number, nowMs?: number }} [opts]
 * @returns {OutlookHighlight[]}
 */
export function buildOutlookHighlights(hourly, opts = {}) {
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  if (!times.length) return [];
  const from = opts.fromIndex != null ? opts.fromIndex : nearestHourIndex(times, opts.nowMs);
  const hours = opts.hours ?? 48;
  const end = Math.min(times.length, from + hours);

  let peakTstorm = null;
  let peakTstormAt = null;
  let minTemp = null;
  let maxTemp = null;
  let maxGust = null;
  /** @type {number | null} */
  let firstDir = null;
  /** @type {number | null} */
  let lastDir = null;

  for (let i = from; i < end; i += 1) {
    const tstorm = numOrNull(
      /** @type {(number | null)[]} */ (hourly?.thunderstorm_probability ?? [])[i],
    );
    if (tstorm != null && (peakTstorm == null || tstorm > peakTstorm)) {
      peakTstorm = tstorm;
      peakTstormAt = times[i];
    }
    const temp = numOrNull(/** @type {(number | null)[]} */ (hourly?.temperature_2m ?? [])[i]);
    if (temp != null) {
      if (minTemp == null || temp < minTemp) minTemp = temp;
      if (maxTemp == null || temp > maxTemp) maxTemp = temp;
    }
    const gust = numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_gusts_10m ?? [])[i]);
    if (gust != null && (maxGust == null || gust > maxGust)) maxGust = gust;
    const dir = numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_direction_10m ?? [])[i]);
    if (dir != null) {
      if (firstDir == null) firstDir = dir;
      lastDir = dir;
    }
  }

  /** @type {OutlookHighlight[]} */
  const bullets = [];
  if (peakTstorm != null && peakTstorm >= 20) {
    const when = peakTstormAt ? formatHourShort(peakTstormAt) : '';
    bullets.push({
      id: 'tstorm',
      text: `Thunderstorm chance peaks near ${Math.round(peakTstorm)}%${when ? ` (${when})` : ''}`,
    });
  }
  if (minTemp != null && maxTemp != null && maxTemp - minTemp >= 8) {
    bullets.push({
      id: 'temp',
      text: `Temperatures swing from ${Math.round(minTemp)}° to ${Math.round(maxTemp)}°F`,
    });
  }
  if (firstDir != null && lastDir != null) {
    const delta = Math.abs(angleDiffDeg(firstDir, lastDir));
    if (delta >= 45) {
      const fromL = windDirLabel(firstDir)?.replace(/\s*\(.*\)/, '') ?? `${Math.round(firstDir)}°`;
      const toL = windDirLabel(lastDir)?.replace(/\s*\(.*\)/, '') ?? `${Math.round(lastDir)}°`;
      bullets.push({
        id: 'wind-shift',
        text: `Wind shifts from ${fromL} toward ${toL}`,
      });
    }
  }
  if (maxGust != null && maxGust >= 30) {
    bullets.push({
      id: 'gust',
      text: `Gusts up to ${Math.round(maxGust)} mph in the next ${hours} hours`,
    });
  }
  return bullets;
}

/**
 * Compact modal table HTML (Time, Icon, Temp/Feels, Precip %, Wind, Gusts, Tstorm %).
 * @param {Record<string, unknown> | null | undefined} hourly
 * @param {{
 *   sunrises?: string[],
 *   sunsets?: string[],
 *   maxRows?: number,
 * }} [opts]
 * @returns {string}
 */
export function buildHourlyModalTableHtml(hourly, opts = {}) {
  const times = /** @type {string[]} */ (hourly?.time ?? []).slice(0, opts.maxRows ?? 48);
  const sunrises = opts.sunrises ?? [];
  const sunsets = opts.sunsets ?? [];
  if (!times.length) {
    return `<p class="empty-state">Hourly forecast unavailable.</p>`;
  }

  const rows = times
    .map((t, i) => {
      const code = numOrNull(/** @type {(number | null)[]} */ (hourly?.weather_code ?? [])[i]);
      const temp = numOrNull(/** @type {(number | null)[]} */ (hourly?.temperature_2m ?? [])[i]);
      const feels = numOrNull(
        /** @type {(number | null)[]} */ (hourly?.apparent_temperature ?? [])[i],
      );
      const precip = numOrNull(
        /** @type {(number | null)[]} */ (hourly?.precipitation_probability ?? [])[i],
      );
      const wind = numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_speed_10m ?? [])[i]);
      const windDir = numOrNull(
        /** @type {(number | null)[]} */ (hourly?.wind_direction_10m ?? [])[i],
      );
      const gust = numOrNull(/** @type {(number | null)[]} */ (hourly?.wind_gusts_10m ?? [])[i]);
      const tstorm = numOrNull(
        /** @type {(number | null)[]} */ (hourly?.thunderstorm_probability ?? [])[i],
      );
      const dayFlag = /** @type {(number | null)[]} */ (hourly?.is_day ?? [])[i];
      const isDay =
        dayFlag === 0 || dayFlag === 1 ? dayFlag === 1 : isDaytime(t, sunrises, sunsets);
      const dirShort = windDirLabel(windDir)?.replace(/\s*\(.*\)/, '') ?? '';
      const windCell =
        wind != null ? `${Math.round(wind)} mph${dirShort ? ` ${escapeHtml(dirShort)}` : ''}` : '—';
      const tempCell =
        temp != null
          ? `${Math.round(temp)}°${feels != null ? ` / ${Math.round(feels)}°` : ''}`
          : '—';
      return `<tr>
        <td>${escapeHtml(formatHourlyModalTime(t))}</td>
        <td class="hourly-modal__cond">${weatherIconHtml(code, { isDay, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })}</td>
        <td>${tempCell}</td>
        <td>${precip != null ? `${Math.round(precip)}%` : '—'}</td>
        <td>${windCell}</td>
        <td>${gust != null ? `${Math.round(gust)} mph` : '—'}</td>
        <td>${tstorm != null ? `${Math.round(tstorm)}%` : '—'}</td>
      </tr>`;
    })
    .join('');

  return `<div class="table-scroll hourly-modal__scroll">
    <table class="data-table data-table--dense hourly-modal__table">
      <caption class="sr-only">48-hour hourly forecast</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Icon</th>
          <th scope="col">Temp / Feels Like</th>
          <th scope="col">Precip %</th>
          <th scope="col">Wind</th>
          <th scope="col">Gusts</th>
          <th scope="col">Thunderstorm Probability</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/**
 * @typedef {{ id: string, label: string, status: string }} SourceChip
 */

/**
 * Human-readable source status for legends.
 * @param {string} status
 * @returns {string}
 */
export function sourceStatusLabel(status) {
  switch (String(status)) {
    case 'ok':
      return 'OK';
    case 'partial':
      return 'Partial';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Unknown';
  }
}

/**
 * Compact HTML legend for source status colors.
 * @returns {string}
 */
export function sourceStatusLegendHtml() {
  const items = [
    ['ok', 'OK'],
    ['partial', 'Partial'],
    ['error', 'Error'],
    ['skipped', 'Skipped'],
  ];
  return `<ul class="source-legend" aria-label="Source status color key">
    ${items
      .map(
        ([status, label]) =>
          `<li class="source-legend__item">
            <span class="source-legend__swatch source-chip--${status}" aria-hidden="true"></span>
            <span class="source-legend__text">${label}</span>
          </li>`,
      )
      .join('')}
  </ul>`;
}

/**
 * @param {unknown[]} sources
 * @returns {SourceChip[]}
 */
export function sourceStatusChips(sources) {
  if (!Array.isArray(sources)) return [];
  /** @type {Record<string, string>} */
  const labels = {
    openmeteo: 'OM',
    openmeteo_aq: 'AQ',
    openmeteo_climatology: 'Climo',
    nws: 'NWS',
    airnow: 'AirNow',
    purpleair: 'PA',
    coagmet: 'CoAg',
    aviation: 'AV',
    cwop: 'CWOP',
    cdot: 'CDOT',
    cotrip: 'COtrip',
    snotel: 'SNOTEL',
    usgs: 'USGS',
    hms: 'HMS',
    spc: 'SPC',
    spc_firewx: 'SPC',
    nifc: 'NIFC',
    nifc_fires: 'NIFC',
    burn_restrictions: 'Burn',
    space_weather: 'SWPC',
    swpc: 'SWPC',
  };
  /** @type {SourceChip[]} */
  const chips = [];
  for (const raw of sources) {
    if (!raw || typeof raw !== 'object') continue;
    const s = /** @type {Record<string, unknown>} */ (raw);
    const id = s.id != null ? String(s.id) : '';
    if (!id) continue;
    const status = s.status != null ? String(s.status) : 'unknown';
    chips.push({
      id,
      label: labels[id] ?? id.slice(0, 6).toUpperCase(),
      status,
    });
  }
  return chips;
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {number[]} nums
 * @returns {number | null}
 */
function modeNumber(nums) {
  if (!nums.length) return null;
  /** @type {Map<number, number>} */
  const counts = new Map();
  let best = nums[0];
  let bestN = 0;
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c > bestN) {
      bestN = c;
      best = n;
    }
  }
  return best;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function angleDiffDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * @param {string} iso
 * @returns {string}
 */
function formatHourShort(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return String(iso);
  }
}

/**
 * @param {string} iso
 * @returns {string}
 */
function formatHourlyModalTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

/**
 * Format a compact hour card time label.
 * @param {string} iso
 * @returns {string}
 */
export function formatCompactHourLabel(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}
