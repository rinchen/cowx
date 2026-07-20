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
