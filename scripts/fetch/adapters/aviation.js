/**
 * Aviation Weather METAR/TAF for Colorado ICAO stations.
 * Failure point: AWC rate limits / empty 204.
 * Fallback: skip aviation block.
 */

import { fetchWithTimeout, NWS_USER_AGENT } from '../../lib/http.js';
import { nearestPoint } from '../../lib/geo.js';

/**
 * @param {import('../../lib/types.js').Location[]} locations
 * @returns {Promise<{ status: string, bySlug: Map<string, object>, error?: string, calls: number }>}
 */
export async function fetchAviation(locations) {
  const bySlug = new Map();
  let calls = 0;

  const icaoSet = new Set();
  for (const loc of locations) {
    if (loc.icao) icaoSet.add(String(loc.icao).toUpperCase());
  }
  // Always include major CO airports
  for (const code of ['KDEN', 'KCOS', 'KGJT', 'KASE', 'KEGE', 'KPUB', 'KFNL', 'KBJC']) {
    icaoSet.add(code);
  }

  const ids = [...icaoSet].join(',');
  if (!ids) {
    return { status: 'skipped', bySlug, calls };
  }

  try {
    calls += 1;
    const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`;
    const metarRes = await fetchWithTimeout(metarUrl, {
      headers: { 'User-Agent': NWS_USER_AGENT },
      timeoutMs: 45_000,
    });

    /** @type {any[]} */
    let metars = [];
    if (metarRes.status === 204) {
      metars = [];
    } else if (!metarRes.ok) {
      throw new Error(`METAR HTTP ${metarRes.status}`);
    } else {
      metars = await metarRes.json();
      if (!Array.isArray(metars)) metars = [];
    }

    calls += 1;
    let tafs = [];
    try {
      const tafUrl = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(ids)}&format=json`;
      const tafRes = await fetchWithTimeout(tafUrl, {
        headers: { 'User-Agent': NWS_USER_AGENT },
        timeoutMs: 45_000,
      });
      if (tafRes.status !== 204 && tafRes.ok) {
        tafs = await tafRes.json();
        if (!Array.isArray(tafs)) tafs = [];
      }
    } catch (err) {
      // TAF optional — METAR alone is still useful
      console.warn('aviation: TAF fetch failed', err instanceof Error ? err.message : String(err));
    }

    const stations = metars
      .filter((m) => m && Number.isFinite(m.lat) && Number.isFinite(m.lon))
      .map((m) => ({
        lat: m.lat,
        lon: m.lon,
        icao: m.icaoId ?? m.stationId,
        raw: m.rawOb ?? m.raw_text ?? null,
        temp_c: m.temp ?? null,
        dewp_c: m.dewp ?? null,
        wdir: m.wdir ?? null,
        wspd: m.wspd ?? null,
        wgst: m.wgst ?? null,
        visib: m.visib ?? null,
        cover: m.cover ?? null,
        fltcat: m.fltCat ?? m.fltcat ?? null,
        altim: m.altim ?? null,
        obsTime: m.obsTime ?? m.reportTime ?? null,
      }));

    const tafByIcao = new Map();
    for (const t of tafs) {
      const id = t.icaoId ?? t.stationId;
      if (id) tafByIcao.set(String(id).toUpperCase(), t.rawTAF ?? t.raw_text ?? null);
    }

    for (const loc of locations) {
      let station = null;
      let distanceKm = null;
      if (loc.icao) {
        station = stations.find(
          (s) => String(s.icao).toUpperCase() === String(loc.icao).toUpperCase(),
        );
      }
      if (!station && stations.length) {
        const n = nearestPoint({ lat: loc.lat, lon: loc.lon }, stations);
        if (n && n.distanceKm <= 80) {
          station = n.point;
          distanceKm = n.distanceKm;
        }
      }
      if (!station) continue;

      const icao = String(station.icao).toUpperCase();
      const tempF =
        station.temp_c != null && Number.isFinite(Number(station.temp_c))
          ? Math.round(Number(station.temp_c) * 1.8 + 32)
          : null;

      bySlug.set(loc.slug, {
        icao,
        distance_km: distanceKm != null ? Math.round(distanceKm * 10) / 10 : 0,
        raw_metar: station.raw,
        temp_f: tempF,
        wind_dir: station.wdir,
        wind_kt: station.wspd,
        gust_kt: station.wgst,
        visibility: station.visib,
        cover: station.cover,
        flight_category: station.fltcat,
        altimeter: station.altim,
        observed: station.obsTime,
        raw_taf: tafByIcao.get(icao) ?? null,
        url: `https://aviationweather.gov/data/metar/?ids=${icao}&hours=0`,
      });
    }

    return {
      status: bySlug.size > 0 ? 'ok' : 'partial',
      bySlug,
      calls,
    };
  } catch (err) {
    return {
      status: 'error',
      bySlug,
      error: err instanceof Error ? err.message : String(err),
      calls,
    };
  }
}
