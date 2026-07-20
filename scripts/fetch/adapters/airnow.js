/**
 * AirNow observations by lat/lon for sample of locations (budget-aware).
 * Failure point: missing key, rate limits.
 * Fallback: skipped/error.
 */

import { fetchJson } from '../../lib/http.js';

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {{ AIRNOW_API_KEY?: string }} env
 */
export async function fetchAirNow(locations, env = process.env) {
  const bySlug = new Map();
  let calls = 0;
  const key = env.AIRNOW_API_KEY;
  if (!key) {
    return { status: 'skipped', bySlug, calls, error: 'AIRNOW_API_KEY not set' };
  }

  // Cap calls: prefer county seats / larger cities — first 40 by name length heuristic + all with icao
  const prioritized = [...locations]
    .sort((a, b) => {
      const score = (l) =>
        (l.icao ? 0 : 1) +
        ([
          'denver',
          'colorado-springs',
          'boulder',
          'fort-collins',
          'longmont',
          'pueblo',
          'grand-junction',
        ].includes(l.slug)
          ? -1
          : 0);
      return score(a) - score(b);
    })
    .slice(0, 40);

  const errors = [];

  for (const loc of prioritized) {
    try {
      calls += 1;
      const url =
        `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json` +
        `&latitude=${loc.lat}&longitude=${loc.lon}&distance=50&API_KEY=${encodeURIComponent(key)}`;
      const data = await fetchJson(url, { timeoutMs: 20_000 });
      if (!Array.isArray(data) || data.length === 0) continue;

      const byParam = {};
      for (const row of data) {
        byParam[row.ParameterName] = {
          aqi: row.AQI,
          category: row.Category?.Name ?? null,
          reporting_area: row.ReportingArea,
          observed: `${row.DateObserved} ${row.HourObserved}`,
        };
      }
      const overall = data.reduce(
        (best, row) => (best == null || (row.AQI ?? 0) > (best.AQI ?? 0) ? row : best),
        null,
      );

      bySlug.set(loc.slug, {
        aqi: overall?.AQI ?? null,
        category: overall?.Category?.Name ?? null,
        parameter: overall?.ParameterName ?? null,
        reporting_area: overall?.ReportingArea ?? null,
        observed: overall ? `${overall.DateObserved} ${overall.HourObserved}` : null,
        by_parameter: byParam,
        url: 'https://www.airnow.gov/',
      });
    } catch (err) {
      errors.push(`${loc.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (bySlug.size === 0 && errors.length) {
    return { status: 'error', bySlug, error: errors.slice(0, 5).join('; '), calls };
  }
  if (errors.length) {
    return { status: 'partial', bySlug, error: errors.slice(0, 5).join('; '), calls };
  }
  return { status: bySlug.size ? 'ok' : 'partial', bySlug, calls };
}
