/**
 * Attach NWS forecast/county zone polygons to alerts that ship with geometry: null
 * (watches / zone products). Warning polygons from the alerts API are left as-is.
 */

/** @type {Map<string, object | null>} */
const zoneGeomCache = new Map();

/**
 * @param {unknown} ugc
 * @returns {{ type: 'forecast' | 'county', id: string } | null}
 */
export function ugcToZoneRef(ugc) {
  const id = String(ugc ?? '')
    .trim()
    .toUpperCase();
  if (/^COZ\d{3}$/.test(id)) return { type: 'forecast', id };
  if (/^COC\d{3}$/.test(id)) return { type: 'county', id };
  return null;
}

/**
 * Collect unique Colorado zone refs from alert geocode.UGC.
 * @param {object[]} features
 * @returns {{ type: 'forecast' | 'county', id: string }[]}
 */
export function collectColoradoZoneRefs(features) {
  /** @type {Map<string, { type: 'forecast' | 'county', id: string }>} */
  const byKey = new Map();
  for (const f of features) {
    if (f?.geometry) continue;
    const ugc = f?.properties?.geocode?.UGC;
    if (!Array.isArray(ugc)) continue;
    for (const code of ugc) {
      const ref = ugcToZoneRef(code);
      if (!ref) continue;
      byKey.set(`${ref.type}/${ref.id}`, ref);
    }
  }
  return [...byKey.values()];
}

/**
 * Merge Polygon / MultiPolygon geometries into one geometry.
 * @param {(object | null | undefined)[]} geoms
 * @returns {{ type: string, coordinates: unknown } | null}
 */
export function mergeZoneGeometries(geoms) {
  /** @type {unknown[]} */
  const polygons = [];
  for (const g of geoms) {
    if (!g || typeof g !== 'object') continue;
    const type = /** @type {{ type?: string, coordinates?: unknown }} */ (g).type;
    const coordinates = /** @type {{ type?: string, coordinates?: unknown }} */ (g).coordinates;
    if (!coordinates) continue;
    if (type === 'Polygon') polygons.push(coordinates);
    else if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
      for (const poly of coordinates) polygons.push(poly);
    }
  }
  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * @param {object} feature
 * @param {Map<string, object | null>} geomByZoneKey
 * @returns {object | null}
 */
export function geometryForAlertFeature(feature, geomByZoneKey) {
  if (feature?.geometry) return feature.geometry;
  const ugc = feature?.properties?.geocode?.UGC;
  if (!Array.isArray(ugc)) return null;
  /** @type {(object | null)[]} */
  const parts = [];
  for (const code of ugc) {
    const ref = ugcToZoneRef(code);
    if (!ref) continue;
    const geom = geomByZoneKey.get(`${ref.type}/${ref.id}`);
    if (geom) parts.push(geom);
  }
  return mergeZoneGeometries(parts);
}

/**
 * Run async work with a concurrency limit.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} worker
 */
async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, Math.max(queue.length, 0)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Fetch one zone geometry (cached).
 * @param {'forecast' | 'county'} type
 * @param {string} id
 * @param {(url: string) => Promise<{ geometry?: object | null } | null>} fetchZoneJson
 * @returns {Promise<object | null>}
 */
export async function loadZoneGeometry(type, id, fetchZoneJson) {
  const key = `${type}/${id}`;
  if (zoneGeomCache.has(key)) return zoneGeomCache.get(key) ?? null;
  try {
    const json = await fetchZoneJson(`https://api.weather.gov/zones/${type}/${id}`);
    const geom = json?.geometry && typeof json.geometry === 'object' ? json.geometry : null;
    zoneGeomCache.set(key, geom);
    return geom;
  } catch {
    zoneGeomCache.set(key, null);
    return null;
  }
}

/**
 * Return alert features with zone geometries filled in when NWS left geometry null.
 * Does not mutate the input array’s objects unless `mutate` is true.
 * @param {object[]} features
 * @param {{
 *   fetchZoneJson: (url: string) => Promise<{ geometry?: object | null } | null>,
 *   concurrency?: number,
 *   mutate?: boolean,
 * }} opts
 * @returns {Promise<object[]>}
 */
export async function hydrateAlertGeometries(features, opts) {
  const list = Array.isArray(features) ? features : [];
  const refs = collectColoradoZoneRefs(list);
  const concurrency = opts.concurrency ?? 6;
  /** @type {Map<string, object | null>} */
  const geomByZoneKey = new Map();

  await mapPool(refs, concurrency, async (ref) => {
    const geom = await loadZoneGeometry(ref.type, ref.id, opts.fetchZoneJson);
    geomByZoneKey.set(`${ref.type}/${ref.id}`, geom);
  });

  return list.map((f) => {
    if (f?.geometry) return opts.mutate ? f : { ...f };
    const geometry = geometryForAlertFeature(f, geomByZoneKey);
    if (!geometry) return opts.mutate ? f : { ...f };
    if (opts.mutate) {
      f.geometry = geometry;
      return f;
    }
    return { ...f, geometry };
  });
}

/** Test helper — clear the process/page zone cache. */
export function _clearZoneGeometryCacheForTests() {
  zoneGeomCache.clear();
}
