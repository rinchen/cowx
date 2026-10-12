/**
 * Local sun/moon astronomy for Colorado locations (no network).
 * Algorithms adapted from SunCalc (Vladimir Agafonkin), MIT License.
 * https://github.com/mourner/suncalc
 *
 * Canonical copy for both the static site and fetch (scripts/lib re-exports this).
 * Pages has no bundler — do not put the only copy under scripts/.
 */

const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const RAD = Math.PI / 180;
const E = RAD * 23.4397;

/**
 * @param {Date} date
 * @returns {number}
 */
function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

/**
 * @param {number} j
 * @returns {Date}
 */
function fromJulian(j) {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

/**
 * @param {Date} date
 * @returns {number}
 */
function toDays(date) {
  return toJulian(date) - J2000;
}

/**
 * @param {number} d
 * @returns {number}
 */
function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}

/**
 * @param {number} M
 * @returns {number}
 */
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

/**
 * @param {number} d
 * @param {number} lw
 * @returns {number}
 */
function approxTransit(Ht, lw, n) {
  return 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
}

/**
 * @param {number} ds
 * @param {number} M
 * @param {number} L
 * @returns {number}
 */
function solarTransitJ(ds, M, L) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

/**
 * @param {number} h
 * @param {number} phi
 * @param {number} dec
 * @returns {number}
 */
function hourAngle(h, phi, dec) {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
}

/**
 * @param {number} d
 * @returns {{ dec: number, ra: number }}
 */
function sunCoords(d) {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return {
    dec: Math.asin(Math.sin(L) * Math.sin(E)),
    ra: Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L)),
  };
}

/**
 * @param {Date} date
 * @param {number} lat
 * @param {number} lon
 * @returns {Record<string, Date | null>}
 */
export function getSunTimes(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(L) * Math.sin(E));
  const Jnoon = solarTransitJ(ds, M, L);

  /**
   * @param {number} hAngleDeg
   * @returns {[Date | null, Date | null]}
   */
  function getSetJ(hAngleDeg) {
    try {
      const h = hourAngle(hAngleDeg * RAD, phi, dec);
      if (Number.isNaN(h)) return [null, null];
      const w = approxTransit(h, lw, n);
      const Jset = solarTransitJ(w, M, L);
      const Jrise = Jnoon - (Jset - Jnoon);
      return [fromJulian(Jrise), fromJulian(Jset)];
    } catch {
      return [null, null];
    }
  }

  const [sunrise, sunset] = getSetJ(-0.833);
  const [sunriseEnd, sunsetStart] = getSetJ(-0.3);
  const [dawn, dusk] = getSetJ(-6);
  const [nauticalDawn, nauticalDusk] = getSetJ(-12);
  const [nightEnd, night] = getSetJ(-18);

  return {
    solarNoon: fromJulian(Jnoon),
    nadir: fromJulian(Jnoon - 0.5),
    sunrise,
    sunset,
    sunriseEnd,
    sunsetStart,
    dawn,
    dusk,
    nauticalDawn,
    nauticalDusk,
    nightEnd,
    night,
  };
}

/**
 * @param {number} d
 * @returns {{ dec: number, dist: number, ra: number }}
 */
function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dt = 385001 - 20905 * Math.cos(M);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)),
    dist: dt,
  };
}

/**
 * @param {Date} date
 * @returns {{ fraction: number, phase: number, angle: number }}
 */
export function getMoonIllumination(date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
    angle,
  };
}

/**
 * @param {number} phase 0–1 lunar cycle
 * @returns {string}
 */
export function moonPhaseLabel(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p >= 0.97) return 'New Moon';
  if (p < 0.22) return 'Waxing Crescent';
  if (p < 0.28) return 'First Quarter';
  if (p < 0.47) return 'Waxing Gibbous';
  if (p < 0.53) return 'Full Moon';
  if (p < 0.72) return 'Waning Gibbous';
  if (p < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

/**
 * @param {number} d
 * @param {number} lw
 * @returns {number}
 */
function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/**
 * @param {Date} date
 * @param {number} h
 * @returns {Date}
 */
function hoursLater(date, h) {
  return new Date(date.valueOf() + (h * DAY_MS) / 24);
}

/**
 * @param {Date} date
 * @param {number} lat
 * @param {number} lon
 * @returns {{ rise: Date | null, set: Date | null, alwaysUp: boolean, alwaysDown: boolean }}
 */
export function getMoonTimes(date, lat, lon) {
  const t = new Date(date);
  t.setUTCHours(0, 0, 0, 0);

  const lw = RAD * -lon;
  const phi = RAD * lat;
  const hc = 0.133 * RAD;

  /**
   * @param {number} d
   * @returns {number}
   */
  function moonAlt(d) {
    const c = moonCoords(d);
    const H = siderealTime(d, lw) - c.ra;
    return Math.asin(
      Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H),
    );
  }

  const h0 = moonAlt(toDays(t)) - hc;
  let rise = /** @type {number | null} */ (null);
  let set = /** @type {number | null} */ (null);
  let ye = 0;
  let hRoot = h0;

  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAlt(toDays(t) + i / 24) - hc;
    const h2 = moonAlt(toDays(t) + (i + 1) / 24) - hc;
    const a = (hRoot + h2) / 2 - h1;
    const b = (h2 - hRoot) / 2;
    const xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const d = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;

    if (d >= 0) {
      const dx = Math.sqrt(d) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots += 1;
      if (Math.abs(x2) <= 1) roots += 1;
      if (x1 < -1) x1 = x2;
    }

    if (roots === 1) {
      if (hRoot < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }

    if (rise != null && set != null) break;
    hRoot = h2;
  }

  /** @type {{ rise: Date | null, set: Date | null, alwaysUp: boolean, alwaysDown: boolean }} */
  const result = {
    rise: rise != null ? hoursLater(t, rise) : null,
    set: set != null ? hoursLater(t, set) : null,
    alwaysUp: false,
    alwaysDown: false,
  };

  if (rise == null && set == null) {
    if (ye > 0) result.alwaysUp = true;
    else result.alwaysDown = true;
  }

  return result;
}

/**
 * @param {Date | null | undefined} d
 * @returns {string | null}
 */
function isoOrNull(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Approximate next quarter phases by scanning daily noon illumination.
 * @param {Date} from
 * @param {number} [count=4]
 * @returns {{ name: string, date: string }[]}
 */
export function nextMoonPhases(from, count = 4) {
  /** @type {{ name: string, phase: number }[]} */
  const targets = [
    { name: 'New Moon', phase: 0 },
    { name: 'First Quarter', phase: 0.25 },
    { name: 'Full Moon', phase: 0.5 },
    { name: 'Last Quarter', phase: 0.75 },
  ];

  /** @type {{ name: string, date: string, t: number }[]} */
  const found = [];
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12),
  );

  for (let day = 0; day < 45 && found.length < count * 2; day += 1) {
    const d = new Date(start.getTime() + day * DAY_MS);
    const prev = new Date(d.getTime() - DAY_MS);
    const p = getMoonIllumination(d).phase;
    const prevP = getMoonIllumination(prev).phase;

    for (const target of targets) {
      const crossed =
        (prevP <= target.phase && p >= target.phase) ||
        (target.phase === 0 && prevP > 0.9 && p < 0.1);
      if (!crossed) continue;
      if (found.some((f) => f.name === target.name && Math.abs(f.t - d.getTime()) < DAY_MS * 10)) {
        continue;
      }
      found.push({
        name: target.name,
        date: d.toISOString().slice(0, 10),
        t: d.getTime(),
      });
    }
  }

  return found
    .filter((f) => f.t >= start.getTime() - DAY_MS)
    .sort((a, b) => a.t - b.t)
    .slice(0, count)
    .map(({ name, date }) => ({ name, date }));
}

/**
 * Denver calendar Y-M-D parts for `now`.
 * @param {Date} now
 * @returns {{ y: number, m: number, day: number, dateStr: string }}
 */
export function denverCalendarParts(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const y = Number(map.year);
  const m = Number(map.month);
  const day = Number(map.day);
  return {
    y,
    m,
    day,
    dateStr: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Build astronomy snapshot for any Colorado catalog lat/lon.
 * @param {number} lat
 * @param {number} lon
 * @param {Date} [now]
 * @returns {Record<string, unknown>}
 */
export function buildAstronomy(lat, lon, now = new Date()) {
  const { y, m, day, dateStr } = denverCalendarParts(now);
  // UTC noon on the Denver calendar date — stable day for rise/set
  const dateForSun = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  const sun = getSunTimes(dateForSun, lat, lon);
  const moonIllum = getMoonIllumination(now);
  const moonTimes = getMoonTimes(new Date(Date.UTC(y, m - 1, day)), lat, lon);

  const sunrise = sun.sunrise;
  const sunset = sun.sunset;
  const dawn = sun.dawn;
  const dusk = sun.dusk;
  const dayLengthS =
    sunrise && sunset
      ? Math.max(0, Math.round((sunset.getTime() - sunrise.getTime()) / 1000))
      : null;
  const visibleLightS =
    dawn && dusk ? Math.max(0, Math.round((dusk.getTime() - dawn.getTime()) / 1000)) : null;

  return {
    date: dateStr,
    sunrise: isoOrNull(sunrise),
    sunset: isoOrNull(sunset),
    civil_twilight: {
      begin: isoOrNull(dawn),
      end: isoOrNull(dusk),
    },
    nautical_twilight: {
      begin: isoOrNull(sun.nauticalDawn),
      end: isoOrNull(sun.nauticalDusk),
    },
    astronomical_twilight: {
      begin: isoOrNull(sun.nightEnd),
      end: isoOrNull(sun.night),
    },
    day_length_s: dayLengthS,
    visible_light_s: visibleLightS,
    moon: {
      phase: Math.round(moonIllum.phase * 1000) / 1000,
      phase_label: moonPhaseLabel(moonIllum.phase),
      illumination_pct: Math.round(moonIllum.fraction * 1000) / 10,
      rise: isoOrNull(moonTimes.rise),
      set: isoOrNull(moonTimes.set),
      always_up: moonTimes.alwaysUp ? true : null,
      always_down: moonTimes.alwaysDown ? true : null,
    },
    next_phases: nextMoonPhases(dateForSun, 4),
  };
}
