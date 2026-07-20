/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */

/** @type {import('leaflet').Map | null} */
let stateMap = null;
/** @type {import('leaflet').TileLayer | null} */
let radarLayer = null;

const CO_CENTER = [39.0, -105.5];
const CO_ZOOM = 7;

/**
 * Initialize or refresh the statewide Leaflet map.
 * @param {HTMLElement} container
 * @param {IndexEntry[]} locations
 * @param {string | null} activeSlug
 * @param {(slug: string) => void} onSelect
 */
export function initStateMap(container, locations, activeSlug, onSelect) {
  if (typeof L === 'undefined') {
    container.innerHTML = '<p class="empty-state">Map library failed to load.</p>';
    return;
  }

  if (stateMap) {
    stateMap.remove();
    stateMap = null;
    radarLayer = null;
  }

  container.innerHTML = '';
  const mapEl = document.createElement('div');
  mapEl.className = 'leaflet-map';
  mapEl.id = 'state-map';
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute('aria-label', 'Colorado locations map');
  container.appendChild(mapEl);

  stateMap = L.map(mapEl, {
    center: CO_CENTER,
    zoom: CO_ZOOM,
    scrollWheelZoom: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(stateMap);

  const bounds = [];
  locations.forEach((loc) => {
    const isActive = loc.slug === activeSlug;
    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius: isActive ? 10 : 7,
      color: isActive ? '#0c4a6e' : '#0369a1',
      fillColor: isActive ? '#0284c7' : '#38bdf8',
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(stateMap);

    marker.bindPopup(`<strong>${loc.name}</strong>${loc.county ? `<br>${loc.county} County` : ''}`);
    marker.on('click', () => onSelect(loc.slug));
    bounds.push([loc.lat, loc.lon]);
  });

  if (bounds.length) {
    stateMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }

  setTimeout(() => stateMap?.invalidateSize(), 100);
}

/**
 * Toggle RainViewer radar overlay.
 * @param {boolean} enabled
 * @param {number} opacity 0–1
 */
export async function setRadarOverlay(enabled, opacity = 0.5) {
  if (!stateMap || typeof L === 'undefined') return;

  if (!enabled) {
    if (radarLayer) {
      stateMap.removeLayer(radarLayer);
      radarLayer = null;
    }
    return;
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
      attribution: '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
    });
    radarLayer.addTo(stateMap);
  } catch {
    /* Graceful degradation — radar stays off */
  }
}

/**
 * @param {HTMLElement} controlsEl
 * @param {(enabled: boolean, opacity: number) => void} onChange
 */
export function bindRadarControls(controlsEl, onChange) {
  const toggle = controlsEl.querySelector('#radar-toggle');
  const opacity = controlsEl.querySelector('#radar-opacity');

  const emit = () => {
    const enabled = /** @type {HTMLInputElement} */ (toggle)?.checked ?? false;
    const op = Number(/** @type {HTMLInputElement} */ (opacity)?.value ?? 50) / 100;
    onChange(enabled, op);
  };

  toggle?.addEventListener('change', emit);
  opacity?.addEventListener('input', emit);
}

export function destroyMap() {
  if (stateMap) {
    stateMap.remove();
    stateMap = null;
    radarLayer = null;
  }
}
