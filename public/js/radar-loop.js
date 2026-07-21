/**
 * RainViewer radar frame loop with pre-buffered Leaflet tile layers.
 */

/** RainViewer free tiles only support zoom 0–7. */
export const RAINVIEWER_MAX_ZOOM = 7;

/**
 * @typedef {{ time: number, path: string }} RadarFrame
 */

/**
 * Select frames covering roughly the last 2 hours (10–15 min spacing from API).
 * @param {{ radar?: { past?: { time: number, path: string }[], nowcast?: { time: number, path: string }[] } }} data
 * @param {number} [hours=2]
 * @returns {RadarFrame[]}
 */
export function selectRadarFrames(data, hours = 2) {
  const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
  const nowcast = Array.isArray(data?.radar?.nowcast) ? data.radar.nowcast : [];
  if (!past.length && !nowcast.length) return [];

  const cutoff = (past.at(-1)?.time ?? Math.floor(Date.now() / 1000)) - hours * 3600;
  const recent = past.filter((f) => f?.path && f.time >= cutoff);
  const frames = [...recent];
  for (const f of nowcast) {
    if (f?.path && !frames.some((x) => x.time === f.time)) frames.push(f);
  }
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

/**
 * RainViewer frame paths are relative (`/v2/radar/...`). Reject absolute or scheme-relative.
 * @param {unknown} path
 * @returns {string | null}
 */
export function safeRadarPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('://') || /[\s\\]/.test(path)) return null;
  return path;
}

/**
 * @param {string} path
 * @returns {string | null}
 */
export function radarTileUrl(path) {
  const safe = safeRadarPath(path);
  if (!safe) return null;
  return `https://tilecache.rainviewer.com${safe}/256/{z}/{x}/{y}/2/1_1.png`;
}

/**
 * Controller for looping radar overlays on a Leaflet map.
 */
export class RadarLoopController {
  /**
   * @param {import('leaflet').Map} map
   * @param {{ opacity?: number, speed?: number, autoplay?: boolean }} [opts]
   */
  constructor(map, opts = {}) {
    this.map = map;
    /** @type {import('leaflet').TileLayer[]} */
    this.layers = [];
    /** @type {RadarFrame[]} */
    this.frames = [];
    this.index = 0;
    this.opacity = opts.opacity ?? 0.55;
    this.speed = opts.speed ?? 1;
    this.playing = false;
    this._timer = null;
    this._autoplay = opts.autoplay !== false;
    this._onFrame = null;
  }

  /**
   * @param {(idx: number, frame: RadarFrame | null) => void} cb
   */
  onFrame(cb) {
    this._onFrame = cb;
  }

  /**
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
   * @returns {Promise<boolean>}
   */
  async load(opts = {}) {
    this.destroy();
    const timeoutMs = opts.timeoutMs ?? 12_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('RainViewer API unavailable');
      const data = await response.json();
      this.frames = selectRadarFrames(data, 2).filter((f) => safeRadarPath(f.path));
      if (!this.frames.length) throw new Error('No radar frames');

      for (const frame of this.frames) {
        const tileUrl = radarTileUrl(frame.path);
        if (!tileUrl) continue;
        const layer = L.tileLayer(tileUrl, {
          opacity: 0,
          maxZoom: RAINVIEWER_MAX_ZOOM,
          maxNativeZoom: RAINVIEWER_MAX_ZOOM,
          attribution: '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
        });
        layer.addTo(this.map);
        this.layers.push(layer);
      }
      if (!this.layers.length) throw new Error('No valid radar tile paths');

      this.index = Math.max(0, this.frames.length - 1);
      this._show(this.index);
      this._notify();

      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (this._autoplay && !reduced) this.play();
      return true;
    } catch (err) {
      console.warn('RadarLoopController.load failed', err);
      this.destroy();
      return false;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  /**
   * @param {number} idx
   */
  _show(idx) {
    this.layers.forEach((layer, i) => {
      layer.setOpacity(i === idx ? this.opacity : 0);
    });
  }

  _notify() {
    this._onFrame?.(this.index, this.frames[this.index] ?? null);
  }

  /**
   * @param {number} idx
   */
  setFrame(idx) {
    if (!this.frames.length) return;
    this.index = Math.max(0, Math.min(this.frames.length - 1, Math.round(idx)));
    this._show(this.index);
    this._notify();
  }

  /**
   * @param {number} opacity 0–1
   */
  setOpacity(opacity) {
    this.opacity = Math.max(0, Math.min(1, opacity));
    if (this.layers[this.index]) this.layers[this.index].setOpacity(this.opacity);
  }

  /**
   * @param {number} speed multiplier
   */
  setSpeed(speed) {
    this.speed = speed > 0 ? speed : 1;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  play() {
    if (!this.frames.length || this.playing) return;
    this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      const next = (this.index + 1) % this.frames.length;
      this.setFrame(next);
      const base = 450;
      this._timer = setTimeout(tick, base / this.speed);
    };
    this._timer = setTimeout(tick, 450 / this.speed);
  }

  pause() {
    this.playing = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  destroy() {
    this.pause();
    for (const layer of this.layers) {
      try {
        this.map.removeLayer(layer);
      } catch {
        /* ignore */
      }
    }
    this.layers = [];
    this.frames = [];
    this.index = 0;
  }
}
