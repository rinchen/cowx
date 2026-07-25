/**
 * Meteocons helpers — WMO / Open-Meteo weather codes → icon slugs.
 * @see https://meteocons.com/docs/getting-started/
 *
 * Icons are vendored under public/img/meteocons/ using the CDN path layout:
 * {format}/{style}/{slug}.svg (svg | svg-static, fill).
 * Resolved via import.meta.url so paths work with or without a trailing slash on /cowx.
 */

import { wmoLabel } from './wmo.js';
import { escapeHtml } from './dom.js';
import { denverHourKey, omLocalOrdinal } from './denver-time.js';

export { wmoLabel };

/** Base URL for vendored icons (…/img/meteocons/), always correct from this module. */
const METEOCONS_BASE = new URL('../img/meteocons/', import.meta.url);

/**
 * @param {number | null | undefined} code
 * @param {boolean} [isDay=true]
 * @returns {string}
 */
export function wmoToMeteoconSlug(code, isDay = true) {
  const day = isDay !== false;
  const c = code == null || Number.isNaN(Number(code)) ? -1 : Number(code);

  if (c === 0 || c === 1) return day ? 'clear-day' : 'clear-night';
  if (c === 2) return day ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (c === 3) return day ? 'overcast-day' : 'overcast-night';
  if (c === 45 || c === 48) return day ? 'fog-day' : 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain';
  if (c >= 85 && c <= 86) return 'snow';
  if (c === 95) return 'thunderstorms';
  if (c === 96 || c === 99) return day ? 'thunderstorms-day-rain' : 'thunderstorms-rain';
  return 'not-available';
}

/**
 * @returns {boolean}
 */
function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * @param {number | null | undefined} code
 * @param {{ isDay?: boolean, size?: number, alt?: string, className?: string }} [opts]
 * @returns {string} HTML for an <img>
 */
export function weatherIconHtml(code, opts = {}) {
  const isDay = opts.isDay !== false;
  const size = opts.size ?? 48;
  const slug = wmoToMeteoconSlug(code, isDay);
  const alt = opts.alt ?? wmoLabel(code);
  const className = String(opts.className ?? 'weather-icon').replace(/[^a-zA-Z0-9_\-\s]/g, '');
  const format = prefersReducedMotion() ? 'svg-static' : 'svg';
  const src = new URL(`${format}/fill/${slug}.svg`, METEOCONS_BASE).href;
  return `<img class="${escapeHtml(className)}" src="${src}" width="${size}" height="${size}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />`;
}

/**
 * Hour 0–23 for a Denver-local (or Z/offset) ISO, without host-TZ `Date` traps.
 * @param {string} isoTime
 * @returns {number}
 */
function hourFromIso(isoTime) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(isoTime)) {
    const d = new Date(isoTime);
    if (Number.isFinite(d.getTime())) {
      // Absolute instants: use America/Denver wall hour
      return Number(denverHourKey(d.getTime()).slice(11, 13));
    }
  }
  const m = /T(\d{2})/.exec(isoTime);
  if (m) return Number(m[1]);
  const ord = omLocalOrdinal(isoTime);
  if (Number.isFinite(ord)) return new Date(ord).getUTCHours();
  return NaN;
}

/**
 * Comparable ms for sunrise/sunset/hourly Open-Meteo Denver-local ISO strings.
 * Absolute (Z/offset) strings use real epoch ms; bare local ISO uses ordinal ms.
 * @param {string} t
 * @returns {number}
 */
function comparableMs(t) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) {
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }
  return omLocalOrdinal(t);
}

/**
 * Coarse day/night when sunrise/sunset arrays are missing (6–20 Denver wall).
 * @param {string | null | undefined} isoTime
 * @returns {boolean}
 */
function coarseDaytime(isoTime) {
  if (!isoTime) {
    const hour = Number(denverHourKey().slice(11, 13));
    return hour >= 6 && hour < 20;
  }
  const hour = hourFromIso(String(isoTime));
  if (!Number.isFinite(hour)) return true;
  return hour >= 6 && hour < 20;
}

/**
 * Infer day/night from ISO time vs sunrise/sunset arrays when available.
 * Offset-less Open-Meteo / astronomy times are America/Denver wall clock — never
 * parse them with host-local `new Date(t)`.
 * @param {string | null | undefined} isoTime
 * @param {string[] | null | undefined} sunrises
 * @param {string[] | null | undefined} sunsets
 * @returns {boolean}
 */
export function isDaytime(isoTime, sunrises, sunsets) {
  if (!isoTime) return coarseDaytime(null);
  try {
    const t = comparableMs(String(isoTime));
    if (!Number.isFinite(t)) return coarseDaytime(String(isoTime));

    if (!Array.isArray(sunrises) || !Array.isArray(sunsets) || !sunrises.length) {
      return coarseDaytime(String(isoTime));
    }
    for (let i = 0; i < Math.min(sunrises.length, sunsets.length); i += 1) {
      const rise = comparableMs(String(sunrises[i]));
      const set = comparableMs(String(sunsets[i]));
      if (!Number.isFinite(rise) || !Number.isFinite(set)) continue;
      if (t >= rise && t < set) return true;
      if (t >= rise - 12 * 3600_000 && t <= set + 12 * 3600_000) {
        return t >= rise && t < set;
      }
    }
    return coarseDaytime(String(isoTime));
  } catch {
    return true;
  }
}
