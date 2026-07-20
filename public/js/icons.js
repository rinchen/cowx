/**
 * Meteocons helpers — WMO / Open-Meteo weather codes → icon slugs.
 * @see https://meteocons.com/
 * CDN: jsDelivr hosts @meteocons/svg (cdn.meteocons.com/latest is 404).
 */

const METEOCONS_SVG = 'https://cdn.jsdelivr.net/npm/@meteocons/svg@0.1.0/fill';
const METEOCONS_STATIC = 'https://cdn.jsdelivr.net/npm/@meteocons/svg-static@0.1.0/fill';

/**
 * @param {number | null | undefined} code
 * @param {boolean} [isDay=true]
 * @returns {string}
 */
export function wmoToMeteoconSlug(code, isDay = true) {
  const day = isDay !== false;
  const c = code == null || Number.isNaN(Number(code)) ? -1 : Number(code);

  if (c === 0) return day ? 'clear-day' : 'clear-night';
  if (c === 1) return day ? 'clear-day' : 'clear-night';
  if (c === 2) return day ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (c === 3) return day ? 'overcast-day' : 'overcast-night';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain';
  if (c >= 85 && c <= 86) return 'snow';
  if (c === 95) return 'thunderstorms';
  if (c === 96 || c === 99) return 'thunderstorms-rain';
  return 'not-available';
}

/**
 * @param {number | null | undefined} code
 * @returns {string}
 */
export function wmoLabel(code) {
  const map = {
    0: 'Clear',
    1: 'Mostly Clear',
    2: 'Partly Cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime Fog',
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
  if (code == null) return '—';
  return map[code] ?? `Code ${code}`;
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
  const className = opts.className ?? 'weather-icon';
  const base = prefersReducedMotion() ? METEOCONS_STATIC : METEOCONS_SVG;
  const src = `${base}/${slug}.svg`;
  return `<img class="${className}" src="${src}" width="${size}" height="${size}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />`;
}

/**
 * Infer day/night from ISO time vs today's sunrise/sunset arrays when available.
 * @param {string | null | undefined} isoTime
 * @param {string[] | null | undefined} sunrises
 * @param {string[] | null | undefined} sunsets
 * @returns {boolean}
 */
export function isDaytime(isoTime, sunrises, sunsets) {
  if (!isoTime) {
    const hour = new Date().getHours();
    return hour >= 6 && hour < 20;
  }
  try {
    const t = new Date(isoTime).getTime();
    if (!Array.isArray(sunrises) || !Array.isArray(sunsets) || !sunrises.length) {
      const hour = new Date(isoTime).getHours();
      return hour >= 6 && hour < 20;
    }
    for (let i = 0; i < Math.min(sunrises.length, sunsets.length); i += 1) {
      const rise = new Date(sunrises[i]).getTime();
      const set = new Date(sunsets[i]).getTime();
      if (t >= rise && t < set) return true;
      if (t >= rise - 12 * 3600_000 && t <= set + 12 * 3600_000) {
        return t >= rise && t < set;
      }
    }
    const hour = new Date(isoTime).getHours();
    return hour >= 6 && hour < 20;
  } catch {
    return true;
  }
}

/**
 * @param {string} s
 */
function escapeAttr(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
