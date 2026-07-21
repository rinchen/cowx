/**
 * Tiny inline SVG charts for the dashboard (no dependencies).
 */

/** Shared plot width so stacked meteograms align. */
export const METEOGRAM_WIDTH = 320;
export const METEOGRAM_HEIGHT = 80;

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
 * Mini bar chart for probability-like values (0–100). Keeps slot count (null → empty).
 * @param {(number | null | undefined)[]} values
 * @param {{ width?: number, height?: number, color?: string }} [opts]
 * @returns {string} SVG HTML string
 */
export function miniBarChartHtml(values, opts = {}) {
  const width = opts.width ?? METEOGRAM_WIDTH;
  const height = opts.height ?? METEOGRAM_HEIGHT;
  const color = opts.color ?? 'currentColor';
  const raw = Array.isArray(values) ? values : [];
  if (raw.length === 0) return '';

  const gap = 1;
  const barW = Math.max(1, (width - gap * (raw.length - 1)) / raw.length);
  const rects = raw
    .map((v, i) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '';
      const h = Math.max(0, Math.min(100, n) / 100) * (height - 2);
      const x = i * (barW + gap);
      const y = height - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    })
    .join('');
  return `<svg class="meteogram mini-bars" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Precipitation chance" aria-hidden="false" focusable="false">${rects}</svg>`;
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
 * Uses index positions; skips non-finite values in the delta check.
 * @param {(number | null)[]} inHgValues
 * @param {{ window?: number, threshold?: number }} [opts]
 * @returns {{ dip: boolean, delta: number, index: number }}
 */
export function detectPressureDip(inHgValues, opts = {}) {
  const window = opts.window ?? 3;
  const threshold = opts.threshold ?? 0.06;
  const nums = Array.isArray(inHgValues) ? inHgValues.map((v) => Number(v)) : [];
  let worst = { dip: false, delta: 0, index: -1 };
  for (let i = window; i < nums.length; i += 1) {
    if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i - window])) continue;
    const delta = nums[i - window] - nums[i];
    if (delta >= threshold && delta > worst.delta) {
      worst = { dip: true, delta, index: i };
    }
  }
  return worst;
}

/**
 * Format a single ISO local hour for the shared axis (e.g. "7 PM").
 * @param {string} iso
 * @returns {string}
 */
function formatAxisHour(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(iso));
  } catch {
    return String(iso).slice(11, 16);
  }
}

/**
 * Hour ticks for the shared time axis, spaced for a ~24h series.
 * @param {string[]} times
 * @param {{ stepHours?: number }} [opts]
 * @returns {{ index: number, label: string, pct: number }[]}
 */
export function formatMeteogramAxisTicks(times, opts = {}) {
  const n = Array.isArray(times) ? times.length : 0;
  if (!n) return [];
  const stepHours = Math.max(1, Math.round(opts.stepHours ?? (n > 18 ? 3 : 2)));
  /** @type {{ index: number, label: string, pct: number }[]} */
  const ticks = [];
  for (let i = 0; i < n; i += stepHours) {
    const label = formatAxisHour(times[i]);
    if (!label) continue;
    ticks.push({
      index: i,
      label,
      pct: n <= 1 ? 0 : (i / (n - 1)) * 100,
    });
  }
  const last = n - 1;
  if (!ticks.length || ticks[ticks.length - 1].index !== last) {
    const label = formatAxisHour(times[last]);
    if (label) {
      ticks.push({ index: last, label, pct: 100 });
    }
  }
  return ticks;
}

/**
 * Format hour labels for the shared time axis (start / mid / end).
 * @param {string[]} times
 * @returns {{ start: string, mid: string, end: string }}
 */
export function formatMeteogramTimeLabels(times) {
  const ticks = formatMeteogramAxisTicks(times);
  if (!ticks.length) return { start: '', mid: '', end: '' };
  const mid = ticks[Math.floor(ticks.length / 2)];
  return {
    start: ticks[0].label,
    mid: mid?.label ?? '',
    end: ticks[ticks.length - 1].label,
  };
}

/**
 * Format a single ISO hour for scrubber / axis readout.
 * @param {string} iso
 * @returns {string}
 */
export function formatMeteogramHour(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return String(iso).slice(0, 16);
  }
}

/**
 * Shared time-axis row under aligned meteograms.
 * Labels are HTML (not SVG text) so they are not squashed by preserveAspectRatio=none.
 * @param {string[]} times
 * @param {{ width?: number, stepHours?: number }} [opts]
 * @returns {string}
 */
export function meteogramTimeAxisHtml(times, opts = {}) {
  const width = opts.width ?? METEOGRAM_WIDTH;
  const ticks = formatMeteogramAxisTicks(times, { stepHours: opts.stepHours });
  if (!ticks.length) return '';
  const tickLines = ticks
    .map((t) => {
      const x = ((t.pct / 100) * width).toFixed(1);
      return `<line x1="${x}" y1="2" x2="${x}" y2="7" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>`;
    })
    .join('');
  const labelSpans = ticks
    .map((t, i) => {
      const edge =
        i === 0
          ? ' meteogram-axis__label--start'
          : i === ticks.length - 1
            ? ' meteogram-axis__label--end'
            : '';
      return `<span class="meteogram-axis__label${edge}" style="left:${t.pct.toFixed(2)}%">${escapeXml(t.label)}</span>`;
    })
    .join('');
  return `<div class="meteogram-axis">
    <svg class="meteogram-axis__ticks" viewBox="0 0 ${width} 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <line x1="0" y1="2" x2="${width}" y2="2" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"/>
      ${tickLines}
    </svg>
    <div class="meteogram-axis__labels" aria-hidden="true">${labelSpans}</div>
  </div>`;
}

/**
 * Map a pointer X to the nearest hour index.
 * @param {number} clientX
 * @param {{ left: number, width: number }} rect
 * @param {number} count
 * @returns {number}
 */
export function meteogramIndexFromX(clientX, rect, count) {
  if (count <= 1) return 0;
  const width = Math.max(rect.width, 1);
  const x = Math.min(Math.max(clientX - rect.left, 0), width);
  return Math.round((x / width) * (count - 1));
}

/**
 * Left % for the scrubber line at a given index.
 * @param {number} index
 * @param {number} count
 * @returns {number}
 */
export function meteogramScrubPercent(index, count) {
  if (count <= 1) return 0;
  const i = Math.min(Math.max(index, 0), count - 1);
  return (i / (count - 1)) * 100;
}

/**
 * Bind a draggable vertical hour marker across the meteogram chart column.
 * @param {HTMLElement} stack
 * @param {{
 *   times: string[],
 *   formatReadout: (index: number) => string,
 *   initialIndex?: number,
 * }} opts
 * @returns {() => void} cleanup
 */
export function bindMeteogramScrubber(stack, opts) {
  const times = Array.isArray(opts.times) ? opts.times : [];
  const layer = /** @type {HTMLElement | null} */ (
    stack.querySelector('[data-meteogram-scrub-layer]')
  );
  const scrubber = /** @type {HTMLElement | null} */ (
    stack.querySelector('[data-meteogram-scrubber]')
  );
  const handle = /** @type {HTMLElement | null} */ (stack.querySelector('[data-meteogram-handle]'));
  const readout = /** @type {HTMLElement | null} */ (
    stack.querySelector('[data-meteogram-readout]')
  );
  if (!layer || !scrubber || times.length === 0) return () => {};

  let index = Math.min(Math.max(opts.initialIndex ?? 0, 0), times.length - 1);
  let dragging = false;

  /**
   * @param {number} next
   */
  function setIndex(next) {
    index = Math.min(Math.max(next, 0), times.length - 1);
    scrubber.style.left = `${meteogramScrubPercent(index, times.length)}%`;
    const text = opts.formatReadout(index);
    if (readout) readout.textContent = text;
    if (handle) {
      handle.setAttribute('aria-valuenow', String(index));
      handle.setAttribute('aria-valuetext', text);
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function indexFromPointer(e) {
    return meteogramIndexFromX(e.clientX, layer.getBoundingClientRect(), times.length);
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    layer.classList.add('is-dragging');
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setIndex(indexFromPointer(e));
    e.preventDefault();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!dragging) return;
    setIndex(indexFromPointer(e));
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    layer.classList.remove('is-dragging');
    try {
      layer.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex(index - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex(index + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndex(times.length - 1);
    }
  }

  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', onPointerUp);
  layer.addEventListener('pointercancel', onPointerUp);
  handle?.addEventListener('keydown', onKeyDown);

  if (handle) {
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', String(times.length - 1));
  }
  setIndex(index);

  return () => {
    layer.removeEventListener('pointerdown', onPointerDown);
    layer.removeEventListener('pointermove', onPointerMove);
    layer.removeEventListener('pointerup', onPointerUp);
    layer.removeEventListener('pointercancel', onPointerUp);
    handle?.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * @param {string} s
 */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build polyline point string, skipping null gaps as separate segments.
 * @param {(number | null)[]} nums
 * @param {number} width
 * @param {number} height
 * @param {number} min
 * @param {number} span
 * @returns {string[]}
 */
function polylineSegments(nums, width, height, min, span) {
  const n = nums.length;
  if (n < 2) return [];
  const step = width / (n - 1);
  /** @type {string[]} */
  const segments = [];
  /** @type {string[]} */
  let cur = [];
  nums.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur.length >= 2) segments.push(cur.join(' '));
      cur = [];
      return;
    }
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (cur.length >= 2) segments.push(cur.join(' '));
  return segments;
}

/**
 * 24h meteogram-style sparkline with optional dual series (e.g. wind + gust).
 * Preserves array length (null gaps) so stacked charts stay aligned.
 * @param {(number | null | undefined)[]} values
 * @param {{
 *   width?: number,
 *   height?: number,
 *   color?: string,
 *   fill?: boolean,
 *   secondary?: (number | null | undefined)[],
 *   secondaryColor?: string,
 *   highlightFrom?: number,
 *   label?: string,
 * }} [opts]
 * @returns {string}
 */
export function meteogramHtml(values, opts = {}) {
  const width = opts.width ?? METEOGRAM_WIDTH;
  const height = opts.height ?? METEOGRAM_HEIGHT;
  const color = opts.color ?? '#0369a1';
  const fill = opts.fill ?? true;
  const label = opts.label ?? 'Trend chart';
  const primary = (Array.isArray(values) ? values : []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
  const finitePrimary = primary.filter((v) => v != null);
  if (finitePrimary.length < 2) return '';

  const secondary = (Array.isArray(opts.secondary) ? opts.secondary : []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
  while (secondary.length < primary.length) secondary.push(null);
  const secondaryTrim = secondary.slice(0, primary.length);

  const finiteAll = [...finitePrimary, ...secondaryTrim.filter((v) => v != null)];
  const min = Math.min(...finiteAll);
  const max = Math.max(...finiteAll);
  const span = max - min || 1;
  const step = width / (primary.length - 1);

  const segs = polylineSegments(primary, width, height, min, span);
  const linePolys = segs
    .map(
      (pts) =>
        `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`,
    )
    .join('');

  let area = '';
  if (fill && segs.length) {
    // Fill under first contiguous segment only (visual cue, not critical).
    const first = segs[0];
    area = `<path d="M${first.split(' ')[0].split(',')[0]},${height} L${first} L${first.split(' ').at(-1)?.split(',')[0] ?? width},${height} Z" fill="${color}" fill-opacity="0.15"/>`;
  }

  const highlight =
    opts.highlightFrom != null && opts.highlightFrom >= 0 && opts.highlightFrom < primary.length
      ? `<line x1="${(opts.highlightFrom * step).toFixed(1)}" y1="0" x2="${(opts.highlightFrom * step).toFixed(1)}" y2="${height}" stroke="#a16207" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.9"/>`
      : '';

  const secSegs = polylineSegments(secondaryTrim, width, height, min, span);
  const sec = secSegs
    .map(
      (pts) =>
        `<polyline fill="none" stroke="${opts.secondaryColor ?? '#c2410c'}" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="3 2" points="${pts}"/>`,
    )
    .join('');

  return `<svg class="meteogram" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeXml(label)}">${area}${highlight}${linePolys}${sec}</svg>`;
}
