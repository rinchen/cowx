/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */

import { RadarLoopController, RAINVIEWER_MAX_ZOOM } from './radar-loop.js';

/** @type {import('leaflet').Map | null} */
let stateMap = null;
/** @type {import('leaflet').TileLayer | null} */
let radarLayer = null;
/** @type {import('leaflet').GeoJSON | null} */
let alertsLayer = null;
/** @type {import('leaflet').GeoJSON | null} */
let cwopLayer = null;
/** @type {RadarLoopController | null} */
let radarLoop = null;

const CO_CENTER = [39.0, -105.5];
const CO_ZOOM = 7;
const LOCALITY_ZOOM = 7;

const SEVERITY_COLORS = {
  Extreme: '#7f1d1d',
  Severe: '#b91c1c',
  Moderate: '#c2410c',
  Minor: '#a16207',
  Unknown: '#64748b',
};

/**
 * @param {string | null | undefined} severity
 */
function severityColor(severity) {
  if (!severity) return SEVERITY_COLORS.Unknown;
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.Unknown;
}

/**
 * Initialize or refresh the Leaflet map.
 * @param {HTMLElement} container
 * @param {IndexEntry[]} locations
 * @param {string | null} activeSlug
 * @param {(slug: string) => void} onSelect
 * @param {{ loadAlerts?: boolean, alertsUrl?: string, onAlertsError?: (msg: string) => void, fixedView?: boolean, showMarkers?: boolean }} [options]
 */
export function initStateMap(container, locations, activeSlug, onSelect, options = {}) {
  if (typeof L === 'undefined') {
    container.innerHTML = '<p class="empty-state">Map library failed to load.</p>';
    return;
  }

  destroyMap();

  container.innerHTML = '';
  const mapEl = document.createElement('div');
  mapEl.className = activeSlug ? 'leaflet-map leaflet-map--locality' : 'leaflet-map';
  mapEl.id = 'state-map';
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute(
    'aria-label',
    activeSlug ? 'Locality map with radar' : 'Colorado locations map',
  );
  container.appendChild(mapEl);

  const active = activeSlug ? locations.find((l) => l.slug === activeSlug) : null;
  const fixedView = Boolean(options.fixedView ?? activeSlug);
  const showMarkers = options.showMarkers !== false && !activeSlug;

  stateMap = L.map(mapEl, {
    center: active ? [active.lat, active.lon] : CO_CENTER,
    zoom: active ? LOCALITY_ZOOM : CO_ZOOM,
    maxZoom: RAINVIEWER_MAX_ZOOM,
    minZoom: 5,
    scrollWheelZoom: false,
    doubleClickZoom: !fixedView,
    boxZoom: !fixedView,
    keyboard: !fixedView,
    dragging: !fixedView,
    zoomControl: !fixedView,
    touchZoom: !fixedView,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: RAINVIEWER_MAX_ZOOM,
  }).addTo(stateMap);

  if (showMarkers) {
    const bounds = [];
    locations.forEach((loc) => {
      const marker = L.circleMarker([loc.lat, loc.lon], {
        radius: 6,
        color: '#0369a1',
        fillColor: '#38bdf8',
        fillOpacity: 0.7,
        weight: 2,
      }).addTo(stateMap);

      // No Leaflet popups — selection navigates via onSelect.
      marker.on('click', () => onSelect(loc.slug));
      marker.bindTooltip(`${loc.name}${loc.county ? ` · ${loc.county} County` : ''}`, {
        direction: 'top',
        opacity: 0.9,
      });
      bounds.push([loc.lat, loc.lon]);
    });

    if (bounds.length) {
      stateMap.fitBounds(bounds, { padding: [40, 40], maxZoom: RAINVIEWER_MAX_ZOOM });
    }
  } else if (active) {
    L.circleMarker([active.lat, active.lon], {
      radius: 8,
      color: '#e0f2fe',
      fillColor: '#38bdf8',
      fillOpacity: 0.9,
      weight: 2,
    })
      .addTo(stateMap)
      .bindTooltip(active.name, { permanent: false });
    stateMap.setView([active.lat, active.lon], LOCALITY_ZOOM);
  }

  setTimeout(() => stateMap?.invalidateSize(), 100);

  if (options.loadAlerts) {
    void loadAlertPolygons(options.alertsUrl ?? 'data/alerts.geojson', options.onAlertsError);
  }
}

/**
 * Draw NWS alert polygons. Failures leave the basemap usable.
 * @param {string} url
 * @param {(msg: string) => void} [onError]
 */
export async function loadAlertPolygons(url, onError) {
  if (!stateMap || typeof L === 'undefined') return;

  if (alertsLayer) {
    stateMap.removeLayer(alertsLayer);
    alertsLayer = null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Alerts geojson HTTP ${response.status}`);
    const geojson = await response.json();
    if (!geojson?.features?.length) return;

    alertsLayer = L.geoJSON(geojson, {
      style(feature) {
        const sev = feature?.properties?.severity;
        return {
          color: severityColor(sev),
          weight: 2,
          fillColor: severityColor(sev),
          fillOpacity: 0.2,
        };
      },
      onEachFeature(feature, layer) {
        const p = feature.properties ?? {};
        const title = p.event ?? 'Alert';
        const sev = p.severity ? ` (${p.severity})` : '';
        const area = p.areaDesc ? `<br>${p.areaDesc}` : '';
        const ends = p.ends ? `<br>Until ${p.ends}` : '';
        const link = p.url
          ? `<br><a href="${p.url}" target="_blank" rel="noopener noreferrer">NWS alert details</a>`
          : '';
        layer.bindTooltip(`<strong>${title}${sev}</strong>${area}${ends}${link}`, {
          sticky: true,
        });
      },
    });
    alertsLayer.addTo(stateMap);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError?.(msg);
  }
}

/**
 * Toggle CWOP/APRS GeoJSON layer.
 * @param {boolean} enabled
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function setCwopLayer(enabled, url = 'data/cwop.geojson') {
  if (!stateMap || typeof L === 'undefined') return false;

  if (cwopLayer) {
    stateMap.removeLayer(cwopLayer);
    cwopLayer = null;
  }
  if (!enabled) return false;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`CWOP geojson HTTP ${response.status}`);
    const geojson = await response.json();
    if (!geojson?.features?.length) return false;

    cwopLayer = L.geoJSON(geojson, {
      pointToLayer(_feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 5,
          color: '#a78bfa',
          fillColor: '#c4b5fd',
          fillOpacity: 0.85,
          weight: 1,
        });
      },
      onEachFeature(feature, layer) {
        const p = feature.properties ?? {};
        const bits = [p.callsign || 'CWOP'];
        if (p.temp_f != null) bits.push(`${Math.round(Number(p.temp_f))}°F`);
        if (p.wind_speed_mph != null) bits.push(`${Math.round(Number(p.wind_speed_mph))} mph`);
        layer.bindTooltip(bits.join(' · '));
      },
    });
    cwopLayer.addTo(stateMap);
    return true;
  } catch {
    return false;
  }
}

/**
 * Legacy single-frame radar toggle (kept for non-workspace callers).
 * @param {boolean} enabled
 * @param {number} opacity 0–1
 * @returns {Promise<boolean>}
 */
export async function setRadarOverlay(enabled, opacity = 0.5) {
  if (!stateMap || typeof L === 'undefined') return false;

  if (radarLoop) {
    radarLoop.destroy();
    radarLoop = null;
  }

  if (!enabled) {
    if (radarLayer) {
      stateMap.removeLayer(radarLayer);
      radarLayer = null;
    }
    return false;
  }

  try {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!response.ok) throw new Error('RainViewer API unavailable');
    const data = await response.json();
    const path = data?.radar?.past?.slice(-1)?.[0]?.path;
    if (!path) throw new Error('No radar frames');

    const url = `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`;

    if (radarLayer) {
      stateMap.removeLayer(radarLayer);
    }

    radarLayer = L.tileLayer(url, {
      opacity,
      maxZoom: RAINVIEWER_MAX_ZOOM,
      maxNativeZoom: RAINVIEWER_MAX_ZOOM,
      attribution: '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
    });
    radarLayer.addTo(stateMap);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {HTMLElement} controlsEl
 * @param {(enabled: boolean, opacity: number) => void} onChange
 * @param {{ defaultOn?: boolean }} [options]
 */
export function bindRadarControls(controlsEl, onChange, options = {}) {
  const toggle = /** @type {HTMLInputElement | null} */ (controlsEl.querySelector('#radar-toggle'));
  const opacity = controlsEl.querySelector('#radar-opacity');

  const emit = () => {
    const enabled = toggle?.checked ?? false;
    const op = Number(/** @type {HTMLInputElement} */ (opacity)?.value ?? 50) / 100;
    onChange(enabled, op);
  };

  toggle?.addEventListener('change', emit);
  opacity?.addEventListener('input', emit);

  if (options.defaultOn && toggle) {
    toggle.checked = true;
    emit();
  }
}

/**
 * Bind workspace radar loop controls (play/scrub/speed/opacity).
 * @param {HTMLElement} controlsEl
 * @param {{ defaultOn?: boolean, onStatus?: (msg: string | null) => void }} [options]
 * @returns {Promise<boolean>}
 */
export async function bindRadarLoopControls(controlsEl, options = {}) {
  if (!stateMap || typeof L === 'undefined') return false;

  if (radarLoop) {
    radarLoop.destroy();
    radarLoop = null;
  }
  if (radarLayer) {
    stateMap.removeLayer(radarLayer);
    radarLayer = null;
  }

  const playBtn = /** @type {HTMLButtonElement | null} */ (controlsEl.querySelector('#radar-play'));
  const scrub = /** @type {HTMLInputElement | null} */ (controlsEl.querySelector('#radar-scrub'));
  const speed = /** @type {HTMLSelectElement | null} */ (controlsEl.querySelector('#radar-speed'));
  const opacity = /** @type {HTMLInputElement | null} */ (
    controlsEl.querySelector('#radar-opacity')
  );
  const timeEl = controlsEl.querySelector('#radar-time');

  radarLoop = new RadarLoopController(stateMap, {
    opacity: Number(opacity?.value ?? 55) / 100,
    speed: Number(speed?.value ?? 1),
    autoplay: options.defaultOn !== false,
  });

  radarLoop.onFrame((idx, frame) => {
    if (scrub) {
      scrub.max = String(Math.max(0, radarLoop.frames.length - 1));
      scrub.value = String(idx);
    }
    if (timeEl && frame) {
      try {
        timeEl.textContent = new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(frame.time * 1000));
      } catch {
        timeEl.textContent = String(frame.time);
      }
    }
    if (playBtn) {
      playBtn.textContent = radarLoop.playing ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-pressed', String(radarLoop.playing));
    }
  });

  const ok = await radarLoop.load();
  if (!ok) {
    options.onStatus?.('RainViewer radar could not load; map basemap is still available.');
    controlsEl.hidden = true;
    return false;
  }
  options.onStatus?.(null);

  playBtn?.addEventListener('click', () => {
    radarLoop?.toggle();
    if (playBtn && radarLoop) {
      playBtn.textContent = radarLoop.playing ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-pressed', String(radarLoop.playing));
    }
  });

  scrub?.addEventListener('input', () => {
    radarLoop?.pause();
    radarLoop?.setFrame(Number(scrub.value));
  });

  speed?.addEventListener('change', () => {
    radarLoop?.setSpeed(Number(speed.value) || 1);
  });

  opacity?.addEventListener('input', () => {
    radarLoop?.setOpacity(Number(opacity.value) / 100);
  });

  return true;
}

export function destroyMap() {
  if (radarLoop) {
    radarLoop.destroy();
    radarLoop = null;
  }
  if (stateMap) {
    stateMap.remove();
    stateMap = null;
    radarLayer = null;
    alertsLayer = null;
    cwopLayer = null;
  }
}
