/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */

/** @type {import('leaflet').Map | null} */
let stateMap = null;
/** @type {import('leaflet').TileLayer | null} */
let radarLayer = null;
/** @type {import('leaflet').GeoJSON | null} */
let alertsLayer = null;

const CO_CENTER = [39.0, -105.5];
/** RainViewer free tiles only support zoom 0–7. */
const RAINVIEWER_MAX_ZOOM = 7;
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
 * @param {{ loadAlerts?: boolean, alertsUrl?: string, onAlertsError?: (msg: string) => void, fixedView?: boolean }} [options]
 */
export function initStateMap(container, locations, activeSlug, onSelect, options = {}) {
  if (typeof L === 'undefined') {
    container.innerHTML = '<p class="empty-state">Map library failed to load.</p>';
    return;
  }

  if (stateMap) {
    stateMap.remove();
    stateMap = null;
    radarLayer = null;
    alertsLayer = null;
  }

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

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: RAINVIEWER_MAX_ZOOM,
  }).addTo(stateMap);

  const bounds = [];
  locations.forEach((loc) => {
    const isActive = loc.slug === activeSlug;
    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius: isActive ? 11 : 6,
      color: isActive ? '#0c4a6e' : '#0369a1',
      fillColor: isActive ? '#0284c7' : '#38bdf8',
      fillOpacity: isActive ? 0.95 : 0.7,
      weight: isActive ? 3 : 2,
    }).addTo(stateMap);

    marker.bindPopup(`<strong>${loc.name}</strong>${loc.county ? `<br>${loc.county} County` : ''}`);
    marker.on('click', () => onSelect(loc.slug));
    bounds.push([loc.lat, loc.lon]);
  });

  if (active) {
    stateMap.setView([active.lat, active.lon], LOCALITY_ZOOM);
  } else if (bounds.length) {
    stateMap.fitBounds(bounds, { padding: [40, 40], maxZoom: RAINVIEWER_MAX_ZOOM });
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
        layer.bindPopup(`<strong>${title}${sev}</strong>${area}${ends}${link}`);
      },
    });
    alertsLayer.addTo(stateMap);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError?.(msg);
  }
}

/**
 * Toggle RainViewer radar overlay.
 * @param {boolean} enabled
 * @param {number} opacity 0–1
 * @returns {Promise<boolean>} whether radar is showing
 */
export async function setRadarOverlay(enabled, opacity = 0.5) {
  if (!stateMap || typeof L === 'undefined') return false;

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
    /* Graceful degradation — radar stays off */
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

export function destroyMap() {
  if (stateMap) {
    stateMap.remove();
    stateMap = null;
    radarLayer = null;
    alertsLayer = null;
  }
}
