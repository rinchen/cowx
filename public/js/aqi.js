/**
 * Shared US AQI pick + category helpers.
 */

/**
 * Prefer AirNow → PurpleAir → Open-Meteo AQ.
 * @param {Record<string, unknown>} data
 * @returns {{ aqi: number | null, pm25: number | null, source: string }}
 */
export function pickAqi(data) {
  const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
  const purpleair = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
  const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
  if (airnow?.aqi != null) {
    return {
      aqi: Number(airnow.aqi),
      pm25: null,
      source: 'AirNow',
    };
  }
  if (purpleair?.aqi_pm25 != null) {
    return {
      aqi: Number(purpleair.aqi_pm25),
      pm25: purpleair.pm25 != null ? Number(purpleair.pm25) : null,
      source: 'PurpleAir',
    };
  }
  if (omaq?.us_aqi != null) {
    return {
      aqi: Number(omaq.us_aqi),
      pm25: omaq.pm25 != null ? Number(omaq.pm25) : null,
      source: 'Open-Meteo',
    };
  }
  return { aqi: null, pm25: null, source: '' };
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
