/**
 * Colorado county keys + FIPS helpers for NWS alert matching.
 * Catalog `county` values are bare names (e.g. "Denver"); NWS areaDesc often
 * uses "Denver, CO" or zone phrases, while geocode.SAME / COC* UGC carry FIPS.
 */

/** @type {Readonly<Record<string, string>>} county key → 3-digit county FIPS */
export const CO_COUNTY_FIPS = Object.freeze({
  adams: '001',
  alamosa: '003',
  arapahoe: '005',
  archuleta: '007',
  baca: '009',
  bent: '011',
  boulder: '013',
  broomfield: '014',
  chaffee: '015',
  cheyenne: '017',
  'clear creek': '019',
  conejos: '021',
  costilla: '023',
  crowley: '025',
  custer: '027',
  delta: '029',
  denver: '031',
  dolores: '033',
  douglas: '035',
  eagle: '037',
  elbert: '039',
  'el paso': '041',
  fremont: '043',
  garfield: '045',
  gilpin: '047',
  grand: '049',
  gunnison: '051',
  hinsdale: '053',
  huerfano: '055',
  jackson: '057',
  jefferson: '059',
  kiowa: '061',
  'kit carson': '063',
  lake: '065',
  'la plata': '067',
  larimer: '069',
  'las animas': '071',
  lincoln: '073',
  logan: '075',
  mesa: '077',
  mineral: '079',
  moffat: '081',
  montezuma: '083',
  montrose: '085',
  morgan: '087',
  otero: '089',
  ouray: '091',
  park: '093',
  phillips: '095',
  pitkin: '097',
  prowers: '099',
  pueblo: '101',
  'rio blanco': '103',
  'rio grande': '105',
  routt: '107',
  saguache: '109',
  'san juan': '111',
  'san miguel': '113',
  sedgwick: '115',
  summit: '117',
  teller: '119',
  washington: '121',
  weld: '123',
  yuma: '125',
});

/** @type {Readonly<Record<string, string>>} 3-digit FIPS → county key */
export const CO_FIPS_TO_COUNTY = Object.freeze(
  Object.fromEntries(Object.entries(CO_COUNTY_FIPS).map(([name, fips]) => [fips, name])),
);

/** Longest county names first so "rio grande" wins over "grand". */
const COUNTY_NAMES_BY_LENGTH = Object.keys(CO_COUNTY_FIPS).sort((a, b) => b.length - a.length);

/**
 * Normalize a catalog or alert county token to the lookup key.
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeCountyKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/,?\s*colorado\b/g, '')
    .replace(/,?\s*co\b/g, '')
    .replace(/\s+county\b/g, '')
    .replace(/\s+&\s+city\b/g, '')
    .replace(/\s+and\s+city\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a SAME / FIPS code (008031 or 031) to a county key.
 * @param {unknown} code
 * @returns {string | null}
 */
export function countyKeyFromFips(code) {
  const raw = String(code ?? '').trim();
  const digits = /^008\d{3}$/.test(raw) ? raw.slice(3) : /^\d{3}$/.test(raw) ? raw : null;
  if (!digits) return null;
  return CO_FIPS_TO_COUNTY[digits] ?? null;
}

/**
 * County keys from NWS geocode SAME + county UGC (COCxxx). Zone UGCs (COZ) ignored.
 * @param {{ SAME?: unknown, UGC?: unknown } | null | undefined} geocode
 * @returns {string[]}
 */
export function countyKeysFromGeocode(geocode) {
  /** @type {Set<string>} */
  const keys = new Set();
  if (!geocode || typeof geocode !== 'object') return [];

  const same = Array.isArray(geocode.SAME) ? geocode.SAME : [];
  for (const code of same) {
    const key = countyKeyFromFips(code);
    if (key) keys.add(key);
  }

  const ugc = Array.isArray(geocode.UGC) ? geocode.UGC : [];
  for (const code of ugc) {
    const m = String(code ?? '')
      .trim()
      .toUpperCase()
      .match(/^COC(\d{3})$/);
    if (!m) continue;
    const key = countyKeyFromFips(m[1]);
    if (key) keys.add(key);
  }

  return [...keys];
}

/**
 * County keys implied by an NWS areaDesc string.
 * Handles "Denver, CO", "Boulder County", and zone phrases that name counties.
 * @param {unknown} areaDesc
 * @returns {string[]}
 */
export function countyKeysFromAreaDesc(areaDesc) {
  /** @type {Set<string>} */
  const keys = new Set();
  const raw = String(areaDesc ?? '');
  if (!raw.trim()) return [];

  for (const part of raw.split(';')) {
    const key = normalizeCountyKey(part);
    if (key && Object.prototype.hasOwnProperty.call(CO_COUNTY_FIPS, key)) {
      keys.add(key);
    }
  }

  const haystack = raw.toLowerCase();
  for (const name of COUNTY_NAMES_BY_LENGTH) {
    const re = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(haystack)) keys.add(name);
  }

  return [...keys];
}

/**
 * Union of areaDesc + geocode county keys for one alert feature properties blob.
 * @param {{ areaDesc?: unknown, geocode?: { SAME?: unknown, UGC?: unknown } }} props
 * @returns {string[]}
 */
export function countyKeysForAlertProps(props) {
  /** @type {Set<string>} */
  const keys = new Set([
    ...countyKeysFromAreaDesc(props?.areaDesc),
    ...countyKeysFromGeocode(props?.geocode),
  ]);
  return [...keys];
}
