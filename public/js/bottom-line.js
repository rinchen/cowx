/**
 * Plain-English "bottom line" headline from location telemetry.
 * Priority: severe hazards → wind/travel → precip/temp → AQ/smoke → nominal.
 */

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
 * @param {Record<string, unknown>} data — location payload
 * @returns {{ headline: string, priority: string }}
 */
export function synthesizeBottomLine(data) {
  const current = /** @type {Record<string, unknown> | null} */ (data.current ?? null);
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
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
  const condition = str(current?.condition || 'Conditions');

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
    return { headline: bits.filter(Boolean).join(': '), priority: 'hazard' };
  }

  // 1b. CDOT road closure / chain law nearby
  const roads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
  const roadAlerts = /** @type {Record<string, unknown>[]} */ (roads?.alerts ?? []);
  const travelHit = roadAlerts.find((a) => a.closure || a.chain_law);
  if (travelHit) {
    const title = str(travelHit.title || travelHit.roads || 'Road advisory');
    const kind = travelHit.chain_law ? 'Chain law' : 'Road closure';
    return {
      headline: `${kind}: ${title}${travelHit.distance_km != null ? ` (${travelHit.distance_km} km)` : ''}`,
      priority: 'travel',
    };
  }

  // 2. Wind & travel
  const maxWind = Math.max(wind ?? 0, gust ?? 0);
  if (maxWind >= 30) {
    const label =
      gust != null && gust >= 30
        ? `Gusts ${Math.round(gust)} mph`
        : `Winds ${Math.round(wind ?? maxWind)} mph`;
    if (isMountain) {
      return {
        headline: `${label} — elevated mountain / pass travel hazard`,
        priority: 'wind',
      };
    }
    return {
      headline: `${label} — expect difficult crosswinds for high-profile vehicles`,
      priority: 'wind',
    };
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
    return { headline: line, priority: 'precip' };
  }
  if (drop != null && drop >= 15) {
    return {
      headline: `Rapid cool-down ahead — about ${Math.round(drop)}°F drop over the next several hours`,
      priority: 'temp',
    };
  }

  // Fire-weather cue without alert
  if (humidity != null && humidity <= 15 && maxWind >= 20 && (num(current?.temp_f) ?? 0) >= 75) {
    return {
      headline: `Hot, dry, and breezy — humidity ${Math.round(humidity)}% with winds near ${Math.round(maxWind)} mph`,
      priority: 'fire',
    };
  }

  // 3b. HMS smoke
  const hms = /** @type {Record<string, unknown> | null} */ (data.hms_smoke ?? null);
  const smokeDensity = str(hms?.density).toLowerCase();
  if (smokeDensity === 'heavy' || smokeDensity === 'medium') {
    return {
      headline: `Satellite smoke plume overhead (${smokeDensity}) — check air quality before outdoor exertion`,
      priority: 'smoke',
    };
  }

  // 4. AQ / smoke
  const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
  const purpleair = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
  const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
  const aqi = num(airnow?.aqi) ?? num(purpleair?.aqi_pm25) ?? num(omaq?.us_aqi);
  const pm25 = num(purpleair?.pm25) ?? num(omaq?.pm25);
  if ((aqi != null && aqi >= 101) || (pm25 != null && pm25 >= 35.5)) {
    const parts = [];
    if (aqi != null) parts.push(`AQI ${Math.round(aqi)}`);
    if (pm25 != null) parts.push(`PM2.5 ${Math.round(pm25)} µg/m³`);
    return {
      headline: `Elevated air quality concern — ${parts.join(' · ')}; limit outdoor exertion if smoke-sensitive`,
      priority: 'aq',
    };
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
  return {
    headline: `${sky}, ${windBit}, ideal outdoor conditions${uvBit}`,
    priority: 'nominal',
  };
}
