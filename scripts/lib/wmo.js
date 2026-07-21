/**
 * Open-Meteo / WMO weather code → English label.
 * Dual copy with public/js/wmo.js (static Pages has no bundler; public/ cannot import scripts/).
 * Keep labels in sync — tests/dom-aqi.test.js asserts parity.
 */

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
 * @param {number | null | undefined} code
 * @returns {string}
 */
export function wmoLabel(code) {
  if (code == null) return '—';
  return WMO[code] ?? `Code ${code}`;
}
