/**
 * America/Denver calendar helpers shared by fetch + client “live” views.
 * Keep free of outlook/current imports so modules can compose without cycles.
 */

/**
 * America/Denver calendar date YYYY-MM-DD.
 * @param {number} [nowMs]
 * @returns {string}
 */
export function denverDateKey(nowMs = Date.now()) {
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
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * America/Denver local hour key YYYY-MM-DDTHH (24h).
 * @param {number} [nowMs]
 * @returns {string}
 */
export function denverHourKey(nowMs = Date.now()) {
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
 * Sum hourly precipitation from America/Denver local midnight through the nearest hour ≤ now.
 * @param {string[]} times
 * @param {(number | null | undefined)[]} precip
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function precipTodayInches(times, precip, nowMs = Date.now()) {
  if (!Array.isArray(times) || !Array.isArray(precip) || times.length === 0) return null;
  const today = denverDateKey(nowMs);
  const hourKey = denverHourKey(nowMs);
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
 * Index of the daily row matching Denver “today”, or -1 if missing.
 * @param {Record<string, unknown> | null | undefined} daily
 * @param {number} [nowMs]
 * @returns {number}
 */
export function dailyIndexForNow(daily, nowMs = Date.now()) {
  const times = /** @type {unknown[]} */ (daily?.time ?? []);
  if (!Array.isArray(times) || times.length === 0) return -1;
  const key = denverDateKey(nowMs);
  for (let i = 0; i < times.length; i += 1) {
    if (String(times[i]).slice(0, 10) === key) return i;
  }
  return -1;
}
