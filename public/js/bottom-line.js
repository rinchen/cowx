/**
 * Plain-English "bottom line" headline from location telemetry.
 * Priority: severe hazards → wind/travel → precip/temp → AQ/smoke → nominal.
 */

import { pickAqi } from './aqi.js';
import { pickNowSky, resolveCatalogNow } from './outlook.js';

/**
 * @param {unknown} s
 * @returns {string}
 */
function str(s) {
  return s == null ? '' : String(s);
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>[]} alerts
 * @returns {Record<string, unknown> | null}
 */
function highestAlert(alerts) {
  if (!Array.isArray(alerts) || !alerts.length) return null;
  const rank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  let best = null;
  let bestRank = -1;
  for (const a of alerts) {
    const sev = str(a.severity || 'Unknown');
    const r = rank[sev] ?? 0;
    const event = str(a.event);
    const isWarning = /warning/i.test(event);
    const score = r * 10 + (isWarning ? 5 : 0);
    if (score > bestRank) {
      bestRank = score;
      best = a;
    }
  }
  return best;
}

/**
 * @param {Record<string, unknown> | null} hourly
 * @param {number} fromIdx
 * @returns {{ hourLabel: string, kind: string } | null}
 */
function nextPrecip(hourly, fromIdx) {
  if (!hourly) return null;
  const times = /** @type {string[]} */ (hourly.time ?? []);
  const probs = /** @type {number[]} */ (hourly.precipitation_probability ?? []);
  const precip = /** @type {number[]} */ (hourly.precipitation ?? []);
  const snow = /** @type {number[]} */ (hourly.snowfall ?? []);
  const rain = /** @type {number[]} */ (hourly.rain ?? []);
  for (let i = fromIdx; i < Math.min(times.length, fromIdx + 18); i += 1) {
    const p = num(probs[i]) ?? 0;
    const amt = num(precip[i]) ?? 0;
    if (p < 40 && amt <= 0) continue;
    const t = times[i];
    let hourLabel = t;
    try {
      hourLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(t));
    } catch {
      /* keep iso */
    }
    const sn = num(snow[i]) ?? 0;
    const rn = (num(rain[i]) ?? 0) + (num(hourly.showers?.[i]) ?? 0);
    let kind = 'Precipitation';
    if (sn > 0 && rn > 0) kind = 'Wintry mix';
    else if (sn > 0) kind = 'Snow';
    else if (rn > 0) kind = 'Rain';
    return { hourLabel, kind };
  }
  return null;
}

/**
 * @param {number[]} temps
 * @param {number} fromIdx
 * @returns {number | null} drop °F over next 6h
 */
function tempDrop(temps, fromIdx) {
  if (!Array.isArray(temps) || temps.length < fromIdx + 6) return null;
  const start = num(temps[fromIdx]);
  if (start == null) return null;
  let min = start;
  for (let i = fromIdx + 1; i <= fromIdx + 6 && i < temps.length; i += 1) {
    const v = num(temps[i]);
    if (v != null && v < min) min = v;
  }
  return start - min;
}

/**
 * Strong NOAA Scales for bottom-line (G≥3, R≥3, or S≥2).
 * @param {Record<string, unknown> | null | undefined} spaceWeather
 * @returns {{ headline: string, priority: string } | null}
 */
function strongSpaceWeather(spaceWeather) {
  if (!spaceWeather || typeof spaceWeather !== 'object') return null;
  const scales = /** @type {Record<string, unknown> | null} */ (spaceWeather.scales ?? null);
  if (!scales) return null;
  const g = num(/** @type {Record<string, unknown>} */ (scales.G ?? {}).scale);
  const r = num(/** @type {Record<string, unknown>} */ (scales.R ?? {}).scale);
  const s = num(/** @type {Record<string, unknown>} */ (scales.S ?? {}).scale);
  if (g != null && g >= 3) {
    return {
      headline: `Geomagnetic storm G${g} — HF may be degraded; aurora possible at Colorado latitudes`,
      priority: 'space',
    };
  }
  if (r != null && r >= 3) {
    return {
      headline: `Radio blackout R${r} — HF absorption likely on the sunlit side of Earth`,
      priority: 'space',
    };
  }
  if (s != null && s >= 2) {
    return {
      headline: `Solar radiation storm S${s} — elevated proton event; polar HF paths may be affected`,
      priority: 'space',
    };
  }
  return null;
}

/**
 * Deep-section id to open when the bottom-line headline is activated.
 * @param {string} priority
 * @returns {string | null}
 */
export function bottomLineJumpTarget(priority) {
  switch (priority) {
    case 'hazard':
      return 'alerts-heading';
    case 'space':
      return 'ham-heading';
    case 'fire':
    case 'smoke':
      return 'smoke-heading';
    case 'travel':
      return 'roads-heading';
    case 'wind':
    case 'precip':
    case 'temp':
      return 'hourly-heading';
    case 'aq':
      return 'aqi-heading';
    default:
      return null;
  }
}

/**
 * @param {Record<string, unknown>} data — location payload
 * @param {{ spaceWeather?: Record<string, unknown> | null }} [options]
 * @returns {{ headline: string, priority: string, jumpTo: string | null }}
 */
export function synthesizeBottomLine(data, options = {}) {
  /**
   * @param {{ headline: string, priority: string }} line
   * @returns {{ headline: string, priority: string, jumpTo: string | null }}
   */
  function withJump(line) {
    return { ...line, jumpTo: bottomLineJumpTarget(line.priority) };
  }

  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const current =
    resolveCatalogNow(
      /** @type {Record<string, unknown> | null} */ (data.current ?? null),
      hourly,
    ) ?? /** @type {Record<string, unknown> | null} */ (data.current ?? null);
  const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
  const elev = num(data.elevation_ft);
  const region = str(data.region).toLowerCase();
  const isMountain =
    elev != null && elev >= 8000
      ? true
      : /mountain|pass|park|san.?juan|summit/.test(region) || /pass/i.test(str(data.name));

  const humidity = num(current?.humidity);
  const gust = num(current?.wind_gust_mph);
  const wind = num(current?.wind_speed_mph);
  const nowSky = pickNowSky(hourly);
  const condition = str(nowSky?.condition || current?.condition || 'Conditions');

  // 1. Severe hazards
  const alert = highestAlert(alerts);
  if (alert) {
    const event = str(alert.event || alert.headline || 'Alert');
    const bits = [event];
    if (/red\s*flag/i.test(event) && humidity != null) {
      bits.push(
        `Extremely low humidity (${Math.round(humidity)}%)${gust != null && gust >= 25 ? ` and high gust potential (${Math.round(gust)} mph)` : ''}`,
      );
    } else if (gust != null && gust >= 40) {
      bits.push(`Gusts near ${Math.round(gust)} mph`);
    } else if (alert.headline && str(alert.headline) !== event) {
      const h = str(alert.headline);
      if (h.length < 120) bits.push(h);
    }
    return withJump({ headline: bits.filter(Boolean).join(': '), priority: 'hazard' });
  }

  // 1a. Strong space weather (G≥3, R≥3, S≥2) — after NWS, before fire/roads
  const swLine = strongSpaceWeather(options.spaceWeather ?? null);
  if (swLine) return withJump(swLine);

  // 1b. SPC Critical/Extreme fire weather (before roads — meteorological hazard)
  const fw = /** @type {Record<string, unknown> | null} */ (data.fire_weather ?? null);
  const day1Rh = str(
    /** @type {Record<string, unknown> | null} */ (fw?.day1)?.windRh,
  ).toLowerCase();
  const day2Rh = str(
    /** @type {Record<string, unknown> | null} */ (fw?.day2)?.windRh,
  ).toLowerCase();
  if (day1Rh === 'extreme' || day1Rh === 'critical') {
    return withJump({
      headline: `SPC Day 1 fire weather ${day1Rh} — critical fire-spread conditions possible`,
      priority: 'fire',
    });
  }
  if (day2Rh === 'extreme' || day2Rh === 'critical') {
    return withJump({
      headline: `SPC Day 2 fire weather ${day2Rh} outlook — prepare for elevated wildfire risk`,
      priority: 'fire',
    });
  }

  // 1c. County burn restriction reported
  const restrictions = /** @type {Record<string, unknown> | null} */ (
    data.fire_restrictions ?? null
  );
  if (restrictions?.status === 'restriction_reported') {
    const county = str(restrictions.county || data.county);
    const where = county ? `${county} County` : 'this county';
    return withJump({
      headline: `Fire restriction reported for ${where} — verify before burning or campfires`,
      priority: 'fire',
    });
  }

  // 1d. CDOT road closure / chain law nearby
  const roads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
  const roadAlerts = /** @type {Record<string, unknown>[]} */ (roads?.alerts ?? []);
  const travelHit = roadAlerts.find((a) => a.closure || a.chain_law);
  if (travelHit) {
    const title = str(travelHit.title || travelHit.roads || 'Road advisory');
    const kind = travelHit.chain_law ? 'Chain law' : 'Road closure';
    return withJump({
      headline: `${kind}: ${title}${travelHit.distance_km != null ? ` (${travelHit.distance_km} km)` : ''}`,
      priority: 'travel',
    });
  }

  // 2. Wind & travel
  const maxWind = Math.max(wind ?? 0, gust ?? 0);
  if (maxWind >= 30) {
    const label =
      gust != null && gust >= 30
        ? `Gusts ${Math.round(gust)} mph`
        : `Winds ${Math.round(wind ?? maxWind)} mph`;
    if (isMountain) {
      return withJump({
        headline: `${label} — elevated mountain / pass travel hazard`,
        priority: 'wind',
      });
    }
    return withJump({
      headline: `${label} — expect difficult crosswinds for high-profile vehicles`,
      priority: 'wind',
    });
  }

  // Hourly index near now
  const times = /** @type {string[]} */ (hourly?.time ?? []);
  let hi = 0;
  if (times.length) {
    const now = Date.now();
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(new Date(t).getTime() - now);
      if (d < bestDiff) {
        bestDiff = d;
        hi = i;
      }
    });
  }

  // 3. Precip & temp trends
  const precip = nextPrecip(hourly, hi);
  const temps = /** @type {number[]} */ (hourly?.temperature_2m ?? []);
  const drop = tempDrop(temps, hi);
  if (precip) {
    let line = `${precip.kind} expected around ${precip.hourLabel}`;
    if (drop != null && drop >= 12) {
      line += `; temperature falling ~${Math.round(drop)}°F`;
    }
    const freeze = num(/** @type {number[]} */ (hourly?.freezing_level_height ?? [])[hi]);
    if (freeze != null && elev != null && freeze * 3.28084 < elev + 500) {
      line += '; road surfaces may cool toward freezing';
    }
    return withJump({ headline: line, priority: 'precip' });
  }
  if (drop != null && drop >= 15) {
    return withJump({
      headline: `Rapid cool-down ahead — about ${Math.round(drop)}°F drop over the next several hours`,
      priority: 'temp',
    });
  }

  // Fire-weather cue without alert
  if (humidity != null && humidity <= 15 && maxWind >= 20 && (num(current?.temp_f) ?? 0) >= 75) {
    return withJump({
      headline: `Hot, dry, and breezy — humidity ${Math.round(humidity)}% with winds near ${Math.round(maxWind)} mph`,
      priority: 'fire',
    });
  }

  // 3b. HMS smoke
  const hms = /** @type {Record<string, unknown> | null} */ (data.hms_smoke ?? null);
  const smokeDensity = str(hms?.density).toLowerCase();
  if (smokeDensity === 'heavy' || smokeDensity === 'medium') {
    return withJump({
      headline: `Satellite smoke plume overhead (${smokeDensity}) — check air quality before outdoor exertion`,
      priority: 'smoke',
    });
  }

  // 4. AQ / smoke
  const { aqi, pm25 } = pickAqi(data);
  if ((aqi != null && aqi >= 101) || (pm25 != null && pm25 >= 35.5)) {
    const parts = [];
    if (aqi != null) parts.push(`AQI ${Math.round(aqi)}`);
    if (pm25 != null) parts.push(`PM2.5 ${Math.round(pm25)} µg/m³`);
    return withJump({
      headline: `Elevated air quality concern — ${parts.join(' · ')}; limit outdoor exertion if smoke-sensitive`,
      priority: 'aq',
    });
  }

  // 5. Nominal (+ high UV note)
  const uv = num(current?.uv_index);
  const windBit =
    maxWind < 8
      ? 'mild winds'
      : maxWind < 18
        ? 'light breeze'
        : `breezy (${Math.round(maxWind)} mph)`;
  const sky = condition || 'Mixed skies';
  const uvBit = uv != null && uv >= 8 ? `; UV ${Math.round(uv)} — sun protection advised` : '';
  return withJump({
    headline: `${sky}, ${windBit}, ideal outdoor conditions${uvBit}`,
    priority: 'nominal',
  });
}
