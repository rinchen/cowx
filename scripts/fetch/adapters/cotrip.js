/**
 * Keyed COtrip traveler JSON API (data.cotrip.org).
 * Feeds: weatherStations, incidents, plannedEvents, roadConditions.
 * Failure point: missing key / HTTP errors / flaky pagination.
 * Fallback: status skipped/error; cameras/ArcGIS alerts still come from cdot adapter.
 */

import {
  fetchWithTimeout,
  sanitizeErrorMessage,
  sanitizeUrlForError,
  sleep,
} from '../../lib/http.js';
import { haversineKm, nearestPoint } from '../../lib/geo.js';
import { toFiniteNumber } from '../../lib/parse.js';

const API_BASE = 'https://data.cotrip.org/';
const COTRIP_MAP = 'https://maps.cotrip.org';
const PAGE_LIMIT = 50;
const MAX_PAGES = 40;
const MAX_RWIS_KM = 40;
const MAX_CONDITION_KM = 35;
const MAX_EVENT_POINT_KM = 75;
const MAX_EVENTS = 5;

const PASS_HINT_RE =
  /\b(i-?70|us-?550|us-?40|us-?285|us-?160|us-?50|loveland|vail|eisenhower|monarch|wolf creek|red mountain|independence|cottonwood|hoosier|berthoud|rabbit ears|cameron|trail ridge|molas|coal bank)\b/i;
const CHAIN_RE = /\bchain\b/i;
const CLOSURE_RE = /\b(closure|closed|lane is closed|lanes? closed)\b/i;

/**
 * NTCIP ESS road-surface status codes (also appear as “N - dry” in roadConditions).
 * @see https://www.ntcip.org/ (ESS pavement sensors)
 */
const SURFACE_STATUS_LABELS = {
  1: 'Other',
  2: 'Error',
  3: 'Dry',
  4: 'Wet',
  5: 'Chemically wet',
  6: 'Ice/snow warning',
  7: 'Ice/snow',
  8: 'Snow warning',
  9: 'Dew',
  10: 'Frost',
  11: 'Absorption',
  12: 'Dry absorption',
  13: 'Wet absorption',
};

/**
 * COtrip sometimes returns next-offset as a Python bytes repr: b'...'.
 * @param {string | null} raw
 * @returns {string | null}
 */
export function normalizeCotripOffset(raw) {
  if (raw == null || raw === '' || raw === 'None') return null;
  let s = String(raw).trim();
  const m = /^b'((?:\\'|[^'])*)'$/.exec(s) || /^b"((?:\\"|[^"])*)"$/.exec(s);
  if (m) s = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
  return s || null;
}

/**
 * @param {number} c
 * @returns {number}
 */
export function celsiusToF(c) {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}

/**
 * @param {number} ms
 * @returns {number}
 */
export function msToMph(ms) {
  return Math.round(ms * 2.23694 * 10) / 10;
}

/**
 * @param {unknown} sensors
 * @returns {Map<string, string>}
 */
export function sensorReadingsByType(sensors) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!Array.isArray(sensors)) return out;
  for (const s of sensors) {
    if (!s || typeof s !== 'object') continue;
    const type = s.type != null ? String(s.type).toLowerCase() : '';
    const reading = s.currentReading != null ? String(s.currentReading) : '';
    if (!type || !reading || reading === 'none') continue;
    out.set(type, reading);
  }
  return out;
}

/**
 * @param {Map<string, string>} byType
 */
export function mapWeatherStationSensors(byType) {
  const airC = toFiniteNumber(byType.get('temperature'));
  const surfaceC = toFiniteNumber(byType.get('road surface temperature'));
  const windMs = toFiniteNumber(byType.get('average wind speed'));
  const gustMs = toFiniteNumber(byType.get('gust wind speed'));
  const humidity = toFiniteNumber(byType.get('humidity'));
  const visibility = toFiniteNumber(byType.get('visibility'));
  const statusRaw = byType.get('road surface status');
  const statusNum = statusRaw != null ? Number(statusRaw) : NaN;
  const surface_status = Number.isFinite(statusNum)
    ? (SURFACE_STATUS_LABELS[statusNum] ?? `Status ${statusNum}`)
    : statusRaw || null;
  return {
    air_temp_f: airC != null ? celsiusToF(airC) : null,
    surface_temp_f: surfaceC != null ? celsiusToF(surfaceC) : null,
    surface_status,
    humidity,
    wind_speed_mph: windMs != null ? msToMph(windMs) : null,
    wind_gust_mph: gustMs != null ? msToMph(gustMs) : null,
    visibility_mi: visibility != null ? Math.round((visibility / 1609.344) * 100) / 100 : null,
    precip_situation: byType.get('precipitation situation') ?? null,
  };
}

/**
 * @param {unknown} feature
 */
export function parseWeatherStationFeature(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const p =
    /** @type {{ properties?: Record<string, unknown>, geometry?: { type?: string, coordinates?: unknown } }} */ (
      feature
    ).properties;
  const geometry = /** @type {{ type?: string, coordinates?: unknown }} */ (feature).geometry;
  if (!p) return null;
  let lat = null;
  let lon = null;
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    lon = toFiniteNumber(geometry.coordinates[0]);
    lat = toFiniteNumber(geometry.coordinates[1]);
  }
  if (lat == null || lon == null) return null;
  const id = String(p.id ?? p.nativeId ?? '');
  if (!id) return null;
  const readings = mapWeatherStationSensors(sensorReadingsByType(p.sensors));
  return {
    id,
    name: String(p.publicName ?? p.name ?? id),
    lat,
    lon,
    road: p.routeName != null ? String(p.routeName) : null,
    observed: p.lastUpdated != null ? String(p.lastUpdated) : null,
    communication_status: p.communicationStatus != null ? String(p.communicationStatus) : null,
    ...readings,
    url: COTRIP_MAP,
  };
}

/**
 * Midpoint helper for MultiPoint / Point.
 * @param {unknown} geometry
 * @returns {{ lat: number, lon: number } | null}
 */
export function geometryPoint(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = /** @type {{ type?: string, coordinates?: unknown }} */ (geometry);
  if (g.type === 'Point' && Array.isArray(g.coordinates)) {
    const lon = toFiniteNumber(g.coordinates[0]);
    const lat = toFiniteNumber(g.coordinates[1]);
    return lat != null && lon != null ? { lat, lon } : null;
  }
  if (g.type === 'MultiPoint' && Array.isArray(g.coordinates) && g.coordinates[0]) {
    const c0 = /** @type {unknown[]} */ (g.coordinates)[0];
    if (Array.isArray(c0)) {
      const lon = toFiniteNumber(c0[0]);
      const lat = toFiniteNumber(c0[1]);
      return lat != null && lon != null ? { lat, lon } : null;
    }
  }
  if (g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length) {
    const mid = /** @type {unknown[]} */ (g.coordinates)[Math.floor(g.coordinates.length / 2)];
    if (Array.isArray(mid)) {
      const lon = toFiniteNumber(mid[0]);
      const lat = toFiniteNumber(mid[1]);
      return lat != null && lon != null ? { lat, lon } : null;
    }
  }
  return null;
}

/**
 * @param {unknown} feature
 * @param {'incident' | 'planned'} kind
 */
export function parseTravelerEventFeature(feature, kind) {
  if (!feature || typeof feature !== 'object') return null;
  const p = /** @type {{ properties?: Record<string, unknown>, geometry?: unknown }} */ (feature)
    .properties;
  if (!p) return null;
  const pt = geometryPoint(/** @type {{ geometry?: unknown }} */ (feature).geometry);
  const lat =
    pt?.lat ??
    toFiniteNumber(p.primaryLatitude) ??
    toFiniteNumber(/** @type {Record<string, unknown>} */ (p).latitude);
  const lon =
    pt?.lon ??
    toFiniteNumber(p.primaryLongitude) ??
    toFiniteNumber(/** @type {Record<string, unknown>} */ (p).longitude);
  if (lat == null || lon == null) return null;
  const id = String(p.id ?? '');
  if (!id) return null;
  const title =
    kind === 'planned' ? String(p.name ?? p.type ?? 'Planned event') : String(p.type ?? 'Incident');
  const description =
    p.travelerInformationMessage != null ? String(p.travelerInformationMessage) : null;
  const roads = p.routeName != null ? String(p.routeName) : null;
  const textBlob = `${title} ${description ?? ''} ${roads ?? ''}`;
  const laneTypes = Array.isArray(p.laneImpacts)
    ? p.laneImpacts
        .flatMap((li) =>
          li && typeof li === 'object' && Array.isArray(li.closedLaneTypes)
            ? li.closedLaneTypes.map(String)
            : [],
        )
        .join(' ')
    : '';
  return {
    id,
    title,
    type: p.type != null ? String(p.type) : null,
    description,
    impact:
      p.severity != null
        ? String(p.severity)
        : p.responseLevel != null
          ? String(p.responseLevel)
          : null,
    roads,
    lat,
    lon,
    chain_law: CHAIN_RE.test(textBlob),
    closure: CLOSURE_RE.test(`${textBlob} ${laneTypes}`),
    pass_relevant: PASS_HINT_RE.test(textBlob),
    observed: p.lastUpdated != null ? String(p.lastUpdated) : null,
    start_time: p.startTime != null ? String(p.startTime) : null,
    clear_time: p.clearTime != null ? String(p.clearTime) : null,
    category: p.category != null ? String(p.category) : null,
    severity: p.severity != null ? String(p.severity) : null,
    source: kind,
    geometry_kind: 'point',
  };
}

/**
 * @param {unknown} feature
 */
export function parseRoadConditionFeature(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const p = /** @type {{ properties?: Record<string, unknown> }} */ (feature).properties;
  if (!p) return null;
  const lat =
    toFiniteNumber(p.primaryLatitude) ??
    geometryPoint(/** @type {{ geometry?: unknown }} */ (feature).geometry)?.lat;
  const lon =
    toFiniteNumber(p.primaryLongitude) ??
    geometryPoint(/** @type {{ geometry?: unknown }} */ (feature).geometry)?.lon;
  if (lat == null || lon == null) return null;
  const id = String(p.id ?? p.nameId ?? '');
  if (!id) return null;
  const conditions = Array.isArray(p.currentConditions) ? p.currentConditions : [];
  /** @type {string | null} */
  let condition = null;
  /** @type {string | null} */
  let forecast_text = null;
  /** @type {string | null} */
  let observed = null;
  for (const c of conditions) {
    if (!c || typeof c !== 'object') continue;
    const desc = c.conditionDescription != null ? String(c.conditionDescription) : '';
    const additional = c.additionalData != null ? String(c.additionalData) : '';
    const src = c.sourceType != null ? String(c.sourceType) : '';
    if (/forecast text/i.test(desc) && additional) {
      forecast_text = additional;
    } else if (desc && !condition) {
      condition = desc.replace(/^\d+\s*-\s*/i, '').trim() || desc;
    }
    if (c.updateTime != null) {
      const n = toFiniteNumber(c.updateTime);
      if (n != null) observed = new Date(n > 1e12 ? n : n * 1000).toISOString();
    }
    if (src === 'OPERATOR' && desc) {
      condition = desc.replace(/^\d+\s*-\s*/i, '').trim() || desc;
    }
  }
  return {
    id,
    name: String(p.name ?? p.nameId ?? id),
    routeName: p.routeName != null ? String(p.routeName) : null,
    lat,
    lon,
    condition,
    forecast_text,
    observed,
    url: COTRIP_MAP,
  };
}

/**
 * Paginated GeoJSON FeatureCollection fetch (apiKey query param).
 * @param {string} path
 * @param {string} apiKey
 * @param {{
 *   limit?: number,
 *   maxPages?: number,
 *   timeoutMs?: number,
 *   sleepFn?: typeof sleep,
 *   fetchFn?: typeof fetchWithTimeout,
 * }} [opts]
 */
export async function fetchCotripCollection(path, apiKey, opts = {}) {
  const limit = opts.limit ?? PAGE_LIMIT;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const sleepFn = opts.sleepFn ?? sleep;
  const fetchFn = opts.fetchFn ?? fetchWithTimeout;
  /** @type {unknown[]} */
  const features = [];
  let offset = null;
  let calls = 0;
  /** @type {string[]} */
  const errors = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(path, API_BASE);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('limit', String(limit));
    if (offset) url.searchParams.set('offset', offset);
    try {
      calls += 1;
      const res = await fetchFn(url.toString(), { timeoutMs });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `HTTP ${res.status} for ${sanitizeUrlForError(url.toString())}: ${sanitizeErrorMessage(body.slice(0, 200))}`,
        );
      }
      const data = await res.json();
      const batch = Array.isArray(data?.features) ? data.features : [];
      features.push(...batch);
      const next = normalizeCotripOffset(res.headers.get('next-offset'));
      if (!next || batch.length === 0) break;
      offset = next;
      await sleepFn(750);
    } catch (err) {
      const msg = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      errors.push(`page ${page + 1}: ${msg}`);
      // Upstream sometimes 500s on page 2+; keep what we have.
      if (features.length > 0) break;
      throw err;
    }
  }

  return { features, calls, errors };
}

/**
 * Keep incidents always; planned events if active or starting within 48h.
 * @param {NonNullable<ReturnType<typeof parseTravelerEventFeature>>} event
 * @param {number} [nowMs]
 */
export function isRelevantTravelerEvent(event, nowMs = Date.now()) {
  if (event.source === 'incident') return true;
  const start = event.start_time ? Date.parse(event.start_time) : NaN;
  const clear = event.clear_time ? Date.parse(event.clear_time) : NaN;
  if (Number.isFinite(clear) && clear < nowMs) return false;
  if (!Number.isFinite(start)) return true;
  const horizonMs = 48 * 60 * 60 * 1000;
  return start <= nowMs + horizonMs;
}

/**
 * @param {{ lat: number, lon: number }} loc
 * @param {ReturnType<typeof parseTravelerEventFeature>[]} events
 */
export function assignEventsForLocation(loc, events) {
  return events
    .filter((e) => e && isRelevantTravelerEvent(e))
    .map((e) => ({
      ...e,
      distance_km: Math.round(haversineKm(loc, e) * 10) / 10,
    }))
    .filter((e) => e.distance_km <= MAX_EVENT_POINT_KM)
    .sort((a, b) => {
      const pri = (x) => {
        if (x.source === 'incident' && x.closure) return 0;
        if (x.source === 'incident') return 1;
        if (x.closure) return 2;
        if (x.chain_law) return 3;
        if (x.pass_relevant) return 4;
        return 5;
      };
      const d = pri(a) - pri(b);
      if (d !== 0) return d;
      return a.distance_km - b.distance_km;
    })
    .slice(0, MAX_EVENTS);
}

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function fetchCotrip(locations, env = process.env) {
  /** @type {Map<string, {
   *   rwis: object | null,
   *   road_condition: object | null,
   *   alerts: object[],
   *   incidents: object[],
   *   planned_events: object[],
   * }>} */
  const bySlug = new Map();
  const key = env.COTRIP_API_KEY;
  if (!key) {
    return { status: 'skipped', bySlug, calls: 0, error: 'COTRIP_API_KEY not set' };
  }

  let calls = 0;
  /** @type {string[]} */
  const errors = [];

  /** @type {ReturnType<typeof parseWeatherStationFeature>[]} */
  let stations = [];
  /** @type {NonNullable<ReturnType<typeof parseTravelerEventFeature>>[]} */
  let incidents = [];
  /** @type {NonNullable<ReturnType<typeof parseTravelerEventFeature>>[]} */
  let planned = [];
  /** @type {NonNullable<ReturnType<typeof parseRoadConditionFeature>>[]} */
  let conditions = [];

  try {
    const ws = await fetchCotripCollection('/api/v1/weatherStations', key, {
      limit: PAGE_LIMIT,
      maxPages: 8,
    });
    calls += ws.calls;
    errors.push(...ws.errors);
    stations = ws.features.map(parseWeatherStationFeature).filter(Boolean);
  } catch (err) {
    errors.push(
      `weatherStations: ${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}`,
    );
  }

  try {
    const inc = await fetchCotripCollection('/api/v1/incidents', key, {
      limit: 100,
      maxPages: 10,
    });
    calls += inc.calls;
    errors.push(...inc.errors);
    incidents = inc.features.map((f) => parseTravelerEventFeature(f, 'incident')).filter(Boolean);
  } catch (err) {
    errors.push(
      `incidents: ${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}`,
    );
  }

  try {
    const pe = await fetchCotripCollection('/api/v1/plannedEvents', key, {
      limit: PAGE_LIMIT,
      maxPages: 10,
    });
    calls += pe.calls;
    errors.push(...pe.errors);
    planned = pe.features.map((f) => parseTravelerEventFeature(f, 'planned')).filter(Boolean);
  } catch (err) {
    errors.push(
      `plannedEvents: ${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}`,
    );
  }

  try {
    // Road-condition geometries are huge — keep page size modest and drop LineStrings in parse.
    const rc = await fetchCotripCollection('/api/v1/roadConditions', key, {
      limit: 40,
      maxPages: 15,
      timeoutMs: 90_000,
    });
    calls += rc.calls;
    errors.push(...rc.errors);
    conditions = rc.features.map(parseRoadConditionFeature).filter(Boolean);
  } catch (err) {
    errors.push(
      `roadConditions: ${sanitizeErrorMessage(err instanceof Error ? err.message : String(err))}`,
    );
  }

  if (!stations.length && !incidents.length && !planned.length && !conditions.length) {
    return {
      status: 'error',
      bySlug,
      calls,
      alertsGeoJson: { type: 'FeatureCollection', features: [] },
      error: (errors.join('; ') || 'COtrip feeds unavailable').slice(0, 500),
    };
  }

  const allEvents = [...incidents, ...planned];

  for (const loc of locations) {
    const rwisHit = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
    let rwis = null;
    if (rwisHit && rwisHit.distanceKm <= MAX_RWIS_KM) {
      const p = /** @type {NonNullable<ReturnType<typeof parseWeatherStationFeature>>} */ (
        rwisHit.point
      );
      rwis = {
        ...p,
        distance_km: Math.round(rwisHit.distanceKm * 10) / 10,
      };
    }

    const condHit = nearestPoint({ lat: loc.lat, lon: loc.lon }, conditions);
    let road_condition = null;
    if (condHit && condHit.distanceKm <= MAX_CONDITION_KM) {
      const p = /** @type {NonNullable<ReturnType<typeof parseRoadConditionFeature>>} */ (
        condHit.point
      );
      road_condition = {
        ...p,
        distance_km: Math.round(condHit.distanceKm * 10) / 10,
      };
    }

    const alerts = assignEventsForLocation({ lat: loc.lat, lon: loc.lon }, allEvents);
    const nearIncidents = assignEventsForLocation({ lat: loc.lat, lon: loc.lon }, incidents);
    const nearPlanned = assignEventsForLocation({ lat: loc.lat, lon: loc.lon }, planned);

    bySlug.set(loc.slug, {
      rwis,
      road_condition,
      alerts,
      incidents: nearIncidents,
      planned_events: nearPlanned,
    });
  }

  const alertsGeoJson = {
    type: 'FeatureCollection',
    features: allEvents.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        title: a.title,
        type: a.type,
        roads: a.roads,
        chain_law: a.chain_law,
        closure: a.closure,
        pass_relevant: a.pass_relevant,
        observed: a.observed,
        source: a.source,
      },
    })),
  };

  const covered = [...bySlug.values()].filter(
    (r) => r.rwis || r.road_condition || r.alerts.length,
  ).length;
  const status =
    covered === 0 ? 'partial' : errors.length ? 'partial' : stations.length < 50 ? 'partial' : 'ok';

  return {
    status,
    bySlug,
    calls,
    alertsGeoJson,
    coverage: {
      stations: stations.length,
      incidents: incidents.length,
      plannedEvents: planned.length,
      roadConditions: conditions.length,
    },
    error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
  };
}
