/**
 * Shared US AQI pick + category helpers.
 */

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function finiteOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Health-conservative summary: max(AirNow, AirGradient) when both exist;
 * else AirNow → AirGradient → Open-Meteo.
 * Also returns dual fields for dual-bar UI.
 * @param {Record<string, unknown>} data
 * @returns {{
 *   aqi: number | null,
 *   pm25: number | null,
 *   source: string,
 *   airnow: number | null,
 *   airgradient: number | null,
 *   openmeteo: number | null,
 * }}
 */
export function pickAqi(data) {
  const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
  const airgradient = /** @type {Record<string, unknown> | null} */ (data.airgradient ?? null);
  const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);

  const anAqi = finiteOrNull(airnow?.aqi);
  const agAqi = finiteOrNull(airgradient?.aqi_pm25);
  const omAqi = finiteOrNull(omaq?.us_aqi);
  const agPm25 = finiteOrNull(airgradient?.pm25);
  const omPm25 = finiteOrNull(omaq?.pm25);

  if (anAqi != null && agAqi != null) {
    const aqi = Math.max(anAqi, agAqi);
    return {
      aqi,
      pm25: agPm25,
      source:
        aqi === anAqi && aqi === agAqi
          ? 'AirNow / AirGradient'
          : aqi === anAqi
            ? 'AirNow'
            : 'AirGradient',
      airnow: anAqi,
      airgradient: agAqi,
      openmeteo: omAqi,
    };
  }
  if (anAqi != null) {
    return {
      aqi: anAqi,
      pm25: agPm25,
      source: 'AirNow',
      airnow: anAqi,
      airgradient: agAqi,
      openmeteo: omAqi,
    };
  }
  if (agAqi != null) {
    return {
      aqi: agAqi,
      pm25: agPm25,
      source: 'AirGradient',
      airnow: anAqi,
      airgradient: agAqi,
      openmeteo: omAqi,
    };
  }
  if (omAqi != null) {
    return {
      aqi: omAqi,
      pm25: omPm25,
      source: 'Open-Meteo',
      airnow: anAqi,
      airgradient: agAqi,
      openmeteo: omAqi,
    };
  }
  return {
    aqi: null,
    pm25: null,
    source: '',
    airnow: null,
    airgradient: null,
    openmeteo: null,
  };
}

/**
 * @param {number | null | undefined} aqi
 * @returns {{ label: string, className: string }}
 */
export function aqiCategory(aqi) {
  if (aqi == null || !Number.isFinite(Number(aqi))) {
    return { label: 'Unavailable', className: 'aqi-ring--na' };
  }
  if (aqi <= 50) return { label: 'Good', className: 'aqi-ring--good' };
  if (aqi <= 100) return { label: 'Moderate', className: 'aqi-ring--moderate' };
  if (aqi <= 150) {
    return { label: 'Unhealthy for sensitive groups', className: 'aqi-ring--usg' };
  }
  if (aqi <= 200) return { label: 'Unhealthy', className: 'aqi-ring--unhealthy' };
  if (aqi <= 300) return { label: 'Very unhealthy', className: 'aqi-ring--very' };
  return { label: 'Hazardous', className: 'aqi-ring--hazardous' };
}

/**
 * AQI gradient bar with marker (0–500 US AQI scale).
 * @param {number} aqi
 * @param {{ label?: string }} [opts]
 * @returns {string}
 */
export function aqiBarHtml(aqi, opts = {}) {
  const n = Math.max(0, Math.min(500, Number(aqi)));
  if (!Number.isFinite(n)) return '';
  const pct = (n / 500) * 100;
  const label = opts.label ?? `AQI ${Math.round(n)} on a 0 to 500 scale`;
  return `<div class="aqi-bar" role="img" aria-label="${label}"><span class="aqi-bar__marker" style="left:${pct}%"></span></div>`;
}

/**
 * Marker colors for US AQI (light-mode readable fills).
 * @param {number | null | undefined} aqi
 * @returns {{ stroke: string, fill: string }}
 */
export function aqiMarkerColor(aqi) {
  const n = Number(aqi);
  if (!Number.isFinite(n)) return { stroke: '#64748b', fill: '#94a3b8' };
  if (n <= 50) return { stroke: '#166534', fill: '#4ade80' };
  if (n <= 100) return { stroke: '#a16207', fill: '#facc15' };
  if (n <= 150) return { stroke: '#c2410c', fill: '#fb923c' };
  if (n <= 200) return { stroke: '#b91c1c', fill: '#f87171' };
  if (n <= 300) return { stroke: '#7e22ce', fill: '#c084fc' };
  return { stroke: '#9f1239', fill: '#fb7185' };
}
