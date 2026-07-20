/**
 * Tiny inline SVG charts for the dashboard (no dependencies).
 */

/**
 * @param {number[]} values
 * @param {{ width?: number, height?: number, color?: string, fill?: boolean }} [opts]
 * @returns {string} SVG HTML string
 */
export function sparklineHtml(values, opts = {}) {
  const width = opts.width ?? 80;
  const height = opts.height ?? 24;
  const color = opts.color ?? 'currentColor';
  const fill = opts.fill ?? false;
  const nums = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (nums.length < 2) return '';

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (nums.length - 1);
  const points = nums.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = points.join(' ');
  const area = fill
    ? `<path d="M0,${height} L${line} L${width},${height} Z" fill="${color}" fill-opacity="0.15"/>`
    : '';
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${area}<polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${line}"/></svg>`;
}

/**
 * Mini bar chart for probability-like values (0–100).
 * @param {number[]} values
 * @param {{ width?: number, height?: number, color?: string }} [opts]
 * @returns {string} SVG HTML string
 */
export function miniBarChartHtml(values, opts = {}) {
  const width = opts.width ?? 80;
  const height = opts.height ?? 24;
  const color = opts.color ?? 'currentColor';
  const nums = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (nums.length === 0) return '';

  const gap = 1;
  const barW = Math.max(1, (width - gap * (nums.length - 1)) / nums.length);
  const rects = nums
    .map((v, i) => {
      const h = Math.max(0, Math.min(100, v) / 100) * height;
      const x = i * (barW + gap);
      const y = height - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    })
    .join('');
  return `<svg class="mini-bars" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${rects}</svg>`;
}

/**
 * Convert millibars / hPa to inches of mercury.
 * @param {number} mb
 * @returns {number}
 */
export function mbToInHg(mb) {
  return Number(mb) * 0.02953;
}

/**
 * Detect a rapid pressure drop (inHg) over a window of samples.
 * Default: ≥ 0.06 inHg drop across ~3 hours (assuming hourly samples).
 * @param {number[]} inHgValues
 * @param {{ window?: number, threshold?: number }} [opts]
 * @returns {{ dip: boolean, delta: number, index: number }}
 */
export function detectPressureDip(inHgValues, opts = {}) {
  const window = opts.window ?? 3;
  const threshold = opts.threshold ?? 0.06;
  const nums = (Array.isArray(inHgValues) ? inHgValues : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  let worst = { dip: false, delta: 0, index: -1 };
  for (let i = window; i < nums.length; i += 1) {
    const delta = nums[i - window] - nums[i];
    if (delta >= threshold && delta > worst.delta) {
      worst = { dip: true, delta, index: i };
    }
  }
  return worst;
}

/**
 * 24h meteogram-style sparkline with optional dual series (e.g. wind + gust).
 * @param {number[]} values
 * @param {{
 *   width?: number,
 *   height?: number,
 *   color?: string,
 *   fill?: boolean,
 *   secondary?: number[],
 *   secondaryColor?: string,
 *   highlightFrom?: number,
 *   label?: string,
 * }} [opts]
 * @returns {string}
 */
export function meteogramHtml(values, opts = {}) {
  const width = opts.width ?? 220;
  const height = opts.height ?? 48;
  const color = opts.color ?? '#7dd3fc';
  const fill = opts.fill ?? true;
  const label = opts.label ?? 'Trend chart';
  const primary = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (primary.length < 2) return '';

  const secondary = (Array.isArray(opts.secondary) ? opts.secondary : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));

  const all = secondary.length ? [...primary, ...secondary] : primary;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const step = width / (primary.length - 1);

  const toPoints = (nums) =>
    nums
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / span) * (height - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const line = toPoints(primary);
  const area = fill
    ? `<path d="M0,${height} L${line} L${width},${height} Z" fill="${color}" fill-opacity="0.18"/>`
    : '';
  const highlight =
    opts.highlightFrom != null && opts.highlightFrom >= 0
      ? `<line x1="${(opts.highlightFrom * step).toFixed(1)}" y1="0" x2="${(opts.highlightFrom * step).toFixed(1)}" y2="${height}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.9"/>`
      : '';
  const sec =
    secondary.length >= 2
      ? `<polyline fill="none" stroke="${opts.secondaryColor ?? '#fb923c'}" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="3 2" points="${toPoints(secondary)}"/>`
      : '';

  return `<svg class="meteogram" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label.replace(/"/g, '')}">${area}${highlight}<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>${sec}</svg>`;
}
