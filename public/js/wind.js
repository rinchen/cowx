/**
 * Wind direction labels and compact compass SVG for forecast surfaces.
 */

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * @param {number | null | undefined} deg
 * @returns {string | null}
 */
export function windDirLabel(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const normalized = ((Number(deg) % 360) + 360) % 360;
  const i = Math.round(normalized / 22.5) % 16;
  return `${dirs[i]} (${Math.round(Number(deg))}°)`;
}

/**
 * Compact wind compass. Meteorological wind_dir is "from"; arrow tip points from that
 * bearing toward the center (into the wind / from the source).
 *
 * @param {number | null | undefined} deg
 * @param {{ size?: number }} [opts]
 * @returns {string} HTML (empty string when deg is missing)
 */
export function windCompassHtml(deg, opts = {}) {
  if (deg == null || Number.isNaN(Number(deg))) return '';
  const size = opts.size ?? 28;
  const normalized = ((Number(deg) % 360) + 360) % 360;
  const label = windDirLabel(normalized) ?? `${Math.round(normalized)}°`;
  const aria = `Wind from ${label}`;
  // SVG y-down: 0° (north/from) → tip at top; rotate clockwise by deg.
  return `<span class="wind-compass" role="img" aria-label="${escapeHtml(aria)}" title="${escapeHtml(aria)}">
  <svg class="wind-compass__svg" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle class="wind-compass__ring" cx="16" cy="16" r="14" fill="none" stroke-width="1.25"/>
    <text class="wind-compass__n" x="16" y="7" text-anchor="middle" font-size="5.5" font-weight="700">N</text>
    <g class="wind-compass__arrow" transform="rotate(${normalized.toFixed(1)} 16 16)">
      <path d="M16 5.5 L19.2 14.5 L16.8 14.5 L16.8 20.5 L15.2 20.5 L15.2 14.5 L12.8 14.5 Z"/>
    </g>
  </svg>
</span>`;
}

/**
 * Wind cell: optional compass + speed text.
 * @param {number | null | undefined} deg
 * @param {number | null | undefined} mph
 * @param {{ size?: number }} [opts]
 * @returns {string}
 */
export function windCellHtml(deg, mph, opts = {}) {
  const compass = windCompassHtml(deg, opts);
  const speed = mph != null && !Number.isNaN(Number(mph)) ? `${Math.round(Number(mph))} mph` : null;
  if (!compass && !speed) return '—';
  if (!compass) return escapeHtml(/** @type {string} */ (speed));
  if (!speed) return compass;
  return `<span class="wind-cell">${compass}<span class="wind-cell__speed">${escapeHtml(speed)}</span></span>`;
}
