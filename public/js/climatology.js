/**
 * Forecast vs ERA5 day-of-year climatology helpers (client).
 */

/** Near-typical band (°F) for “near typical” copy. */
export const NEAR_TYPICAL_F = 2;

/**
 * Climate calendar index 0–365 (Jan 1 … Dec 31; slot 59 = Feb 29).
 * @param {string | Date} date
 * @returns {number | null}
 */
export function climateDoyIndex(date) {
  let month;
  let day;
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!m) return null;
    month = Number(m[2]);
    day = Number(m[3]);
  } else if (date instanceof Date && !Number.isNaN(date.getTime())) {
    month = date.getMonth() + 1;
    day = date.getDate();
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (month === 2 && day === 29) return 59;
  const leapCum = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  const idx = leapCum[month - 1] + day - 1;
  return idx >= 0 && idx < 366 ? idx : null;
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
 * @param {Record<string, unknown> | null | undefined} climatology
 * @param {string | Date} date
 * @returns {{ tmax: number | null, tmin: number | null, precip: number | null } | null}
 */
export function normalForDate(climatology, date) {
  if (!climatology || typeof climatology !== 'object') return null;
  const doy = /** @type {{ doy?: Record<string, unknown> }} */ (climatology).doy;
  if (!doy || typeof doy !== 'object') return null;
  const idx = climateDoyIndex(date);
  if (idx == null) return null;
  const tmaxArr = /** @type {(number | null)[]} */ (doy.temperature_2m_max ?? []);
  const tminArr = /** @type {(number | null)[]} */ (doy.temperature_2m_min ?? []);
  const precipArr = /** @type {(number | null)[]} */ (doy.precipitation_sum ?? []);
  return {
    tmax: numOrNull(tmaxArr[idx]),
    tmin: numOrNull(tminArr[idx]),
    precip: numOrNull(precipArr[idx]),
  };
}

/**
 * Forecast minus normal (°F or inches).
 * @param {number | null | undefined} forecast
 * @param {number | null | undefined} normal
 * @returns {number | null}
 */
export function deltaVsNormal(forecast, normal) {
  const f = numOrNull(forecast);
  const n = numOrNull(normal);
  if (f == null || n == null) return null;
  return f - n;
}

/**
 * Signed degree delta: "+6°", "−3°", "0°".
 * @param {number | null | undefined} delta
 * @returns {string | null}
 */
export function formatTempDelta(delta) {
  const d = numOrNull(delta);
  if (d == null) return null;
  const rounded = Math.round(d);
  if (rounded === 0) return '0°';
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded)}°`;
}

/**
 * Human label for high anomaly vs typical.
 * @param {number | null | undefined} deltaF
 * @param {{ nearF?: number }} [opts]
 * @returns {string | null}
 */
export function formatVsTypicalShort(deltaF, opts = {}) {
  const near = opts.nearF ?? NEAR_TYPICAL_F;
  const d = numOrNull(deltaF);
  if (d == null) return null;
  if (Math.abs(d) < near) return 'near typical';
  const label = formatTempDelta(d);
  return label ? `${label} vs typical` : null;
}

/**
 * Combined hi/lo vs-typical phrase for At a Glance.
 * @param {number | null | undefined} hi
 * @param {number | null | undefined} lo
 * @param {{ tmax: number | null, tmin: number | null } | null} normal
 * @returns {string | null}
 */
export function formatTodayVsTypical(hi, lo, normal) {
  if (!normal) return null;
  const dHi = deltaVsNormal(hi, normal.tmax);
  const dLo = deltaVsNormal(lo, normal.tmin);
  if (dHi == null && dLo == null) return null;
  if (dHi != null && dLo != null) {
    const a = formatTempDelta(dHi);
    const b = formatTempDelta(dLo);
    if (Math.abs(dHi) < NEAR_TYPICAL_F && Math.abs(dLo) < NEAR_TYPICAL_F) {
      return 'near typical for this date';
    }
    return `High ${a} · Low ${b} vs typical`;
  }
  if (dHi != null) return formatVsTypicalShort(dHi);
  return formatVsTypicalShort(dLo);
}

/**
 * Today’s high/low with inline deltas: "High 96° (+9°) · Low 70° (+10°)".
 * @param {number | null | undefined} hi
 * @param {number | null | undefined} lo
 * @param {{ tmax: number | null, tmin: number | null } | null} [normal]
 * @returns {string | null}
 */
export function formatTodayRangeWithDeltas(hi, lo, normal = null) {
  const h = numOrNull(hi);
  const l = numOrNull(lo);
  if (h == null || l == null) return null;
  const dHi = normal ? deltaVsNormal(h, normal.tmax) : null;
  const dLo = normal ? deltaVsNormal(l, normal.tmin) : null;
  const hiDelta = formatTempDelta(dHi);
  const loDelta = formatTempDelta(dLo);
  const hiBit =
    hiDelta && hiDelta !== '0°' ? `High ${Math.round(h)}° (${hiDelta})` : `High ${Math.round(h)}°`;
  const loBit =
    loDelta && loDelta !== '0°' ? `Low ${Math.round(l)}° (${loDelta})` : `Low ${Math.round(l)}°`;
  return `${hiBit} · ${loBit}`;
}

/**
 * Precip vs typical: wetter / drier / near.
 * @param {number | null | undefined} forecastIn
 * @param {number | null | undefined} normalIn
 * @param {{ nearIn?: number }} [opts]
 * @returns {string | null}
 */
export function formatPrecipVsTypical(forecastIn, normalIn, opts = {}) {
  const near = opts.nearIn ?? 0.05;
  const d = deltaVsNormal(forecastIn, normalIn);
  if (d == null) return null;
  if (Math.abs(d) < near) return 'near typical precip';
  if (d > 0) return `+${d.toFixed(2)} in vs typical`;
  return `−${Math.abs(d).toFixed(2)} in vs typical`;
}

/**
 * Period label for legend (ERA5 window).
 * @param {Record<string, unknown> | null | undefined} climatology
 * @returns {string}
 */
export function climatologyPeriodLabel(climatology) {
  const start =
    climatology?.periodStart != null ? String(climatology.periodStart).slice(0, 4) : '1991';
  const end = climatology?.periodEnd != null ? String(climatology.periodEnd).slice(0, 4) : '2020';
  return `${start}–${end}`;
}

/**
 * Compare one forecast daily row to climatology.
 * @param {Record<string, unknown> | null | undefined} climatology
 * @param {string} isoDate
 * @param {number | null | undefined} hi
 * @param {number | null | undefined} lo
 * @param {number | null | undefined} precip
 */
export function compareDailyToNormal(climatology, isoDate, hi, lo, precip) {
  const normal = normalForDate(climatology, isoDate);
  if (!normal) {
    return {
      normal: null,
      deltaHi: null,
      deltaLo: null,
      deltaPrecip: null,
      vsTypicalLabel: null,
      precipLabel: null,
    };
  }
  const deltaHi = deltaVsNormal(hi, normal.tmax);
  const deltaLo = deltaVsNormal(lo, normal.tmin);
  const deltaPrecip = deltaVsNormal(precip, normal.precip);
  return {
    normal,
    deltaHi,
    deltaLo,
    deltaPrecip,
    vsTypicalLabel:
      deltaHi != null || deltaLo != null
        ? [formatTempDelta(deltaHi), formatTempDelta(deltaLo)].filter(Boolean).join(' / ') || null
        : null,
    precipLabel: formatPrecipVsTypical(precip, normal.precip),
  };
}
