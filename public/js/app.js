import { findNearestLocation, resolveBrowserGeolocation, resolveIpGeolocation } from './geo.js';
import {
  getFavorites,
  getPreferredSlug,
  isFavorite,
  setLastLocation,
  toggleFavorite,
} from './favorites.js';
import { getFavoriteLocations, searchLocations } from './search.js';
import { renderDashboard } from './dashboard.js';
import { bindRadarControls, destroyMap, initStateMap, setRadarOverlay } from './map.js';

/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string }} IndexEntry */
/** @typedef {{ city: string; county: string; slug: string }} ZipEntry */

const DATA_BASE = 'data';

/** @type {IndexEntry[]} */
let locations = [];
/** @type {ZipEntry[] | Record<string, ZipEntry>} */
let zipTable = [];
/** @type {Record<string, unknown> | null} */
let meta = null;

const els = {
  status: /** @type {HTMLElement | null} */ (null),
  errorBanner: /** @type {HTMLElement | null} */ (null),
  main: /** @type {HTMLElement | null} */ (null),
  updatedFooter: /** @type {HTMLElement | null} */ (null),
};

/**
 * @param {string} message
 * @param {'polite' | 'assertive'} [priority]
 */
function announce(message, priority = 'polite') {
  if (!els.status) return;
  els.status.setAttribute('aria-live', priority);
  els.status.textContent = '';
  requestAnimationFrame(() => {
    if (els.status) els.status.textContent = message;
  });
}

/**
 * @param {string | null} message
 */
function showError(message) {
  if (!els.errorBanner) return;
  if (!message) {
    els.errorBanner.hidden = true;
    els.errorBanner.textContent = '';
    return;
  }
  els.errorBanner.hidden = false;
  els.errorBanner.textContent = message;
}

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function fetchJson(path) {
  const response = await fetch(`${DATA_BASE}/${path}`);
  if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
  return response.json();
}

/**
 * Load core datasets. Partial failure surfaces banner but keeps UI usable.
 */
async function loadCoreData() {
  const errors = [];

  try {
    meta = /** @type {Record<string, unknown>} */ (await fetchJson('meta.json'));
  } catch {
    errors.push('Could not load data freshness metadata.');
    meta = null;
  }

  try {
    const index = /** @type {{ locations?: IndexEntry[]; updated_at?: string } } */ (
      await fetchJson('index.json')
    );
    locations = index.locations ?? [];
    if (index.updated_at && meta) {
      meta.updated_at = index.updated_at;
    }
  } catch {
    errors.push('Could not load location index — search and geo lookup unavailable.');
    locations = [];
  }

  try {
    const zipsRaw = await fetchJson('co-zips.json');
    zipTable = Array.isArray(zipsRaw)
      ? /** @type {ZipEntry[]} */ (zipsRaw)
      : /** @type {Record<string, ZipEntry>} */ (zipsRaw);
  } catch {
    errors.push('ZIP lookup table unavailable — search by ZIP disabled.');
    zipTable = [];
  }

  showError(errors.length ? errors.join(' ') : null);
  updateFooterTimestamp();
}

/**
 * @returns {string | null}
 */
function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const match = hash.match(/^\/l\/([a-z0-9-]+)$/);
  if (match) return match[1];
  if (hash === '/' || hash === '') return null;
  return null;
}

/**
 * @param {string | null} slug
 */
function navigateTo(slug) {
  if (slug) {
    window.location.hash = `#/l/${slug}`;
    return;
  }
  goHome();
}

/**
 * Always land on the find-location page (even if hash is already `#/`).
 */
function goHome() {
  if (parseRoute() == null) {
    void handleRoute();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.location.hash = '#/';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Logo / Home / Change location — preventDefault so navigation is explicit.
 */
function bindHomeNavigation() {
  document.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const link = target?.closest?.('[data-nav-home]');
    if (!link) return;
    event.preventDefault();
    goHome();
  });
}

/**
 * @param {string} slug
 * @returns {IndexEntry | undefined}
 */
function findLocation(slug) {
  return locations.find((l) => l.slug === slug);
}

function updateFooterTimestamp() {
  if (!els.updatedFooter) return;
  const ts = meta?.updated_at ?? meta?.generatedAt;
  els.updatedFooter.textContent = ts
    ? `Data updated ${formatTimestamp(String(ts))}`
    : 'Data update time unknown';
}

/**
 * @param {string} iso
 * @returns {string}
 */
function formatTimestamp(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Render geo resolve view at root hash.
 * Stays on this page unless the user explicitly picks a location.
 */
async function renderResolveView() {
  if (!els.main) return;
  destroyMap();

  const preferred = getPreferredSlug();
  const preferredLoc = preferred ? findLocation(preferred) : null;

  els.main.innerHTML = `
    <section class="resolve-card" aria-labelledby="resolve-heading">
      <h1 id="resolve-heading">Find your Colorado weather</h1>
      <p class="lead">Search, locate yourself, or continue where you left off.</p>
      <div class="resolve-actions">
        ${
          preferredLoc
            ? `<button type="button" class="btn btn-primary" id="btn-continue" data-slug="${preferredLoc.slug}">Continue to ${preferredLoc.name}</button>`
            : ''
        }
        <button type="button" class="btn ${preferredLoc ? 'btn-secondary' : 'btn-primary'}" id="btn-locate">Locate me</button>
      </div>
      <p class="resolve-status" id="resolve-status" aria-live="polite"></p>
    </section>
    <section class="search-panel" id="search-panel" aria-labelledby="search-heading">
      <h2 id="search-heading">Search locations</h2>
      <label for="location-search">City, county, or ZIP</label>
      <input type="search" id="location-search" name="q" autocomplete="off" enterkeyhint="search" />
      <ul id="search-results" class="search-results" role="listbox" aria-label="Search results"></ul>
    </section>
    <section class="favorites-panel" aria-labelledby="favorites-heading">
      <h2 id="favorites-heading">Favorites</h2>
      <ul id="favorites-list" class="location-list"></ul>
    </section>
    <section class="map-section" aria-labelledby="map-heading">
      <h2 id="map-heading">Colorado overview</h2>
      <div class="map-controls">
        <label class="checkbox-label">
          <input type="checkbox" id="radar-toggle" />
          RainViewer radar
        </label>
        <label for="radar-opacity" class="opacity-label">
          Opacity
          <input type="range" id="radar-opacity" min="10" max="90" value="50" />
        </label>
      </div>
      <div id="map-container" class="map-container"></div>
    </section>
  `;

  renderFavoritesList(document.getElementById('favorites-list'));
  bindSearch(document.getElementById('search-panel'));
  initStateMap(
    /** @type {HTMLElement} */ (document.getElementById('map-container')),
    locations,
    null,
    (slug) => navigateTo(slug),
  );
  bindRadarControls(
    /** @type {HTMLElement} */ (document.querySelector('.map-controls')),
    (enabled, opacity) => setRadarOverlay(enabled, opacity),
  );

  const statusEl = document.getElementById('resolve-status');

  document.getElementById('btn-continue')?.addEventListener('click', () => {
    const slug = /** @type {HTMLButtonElement} */ (document.getElementById('btn-continue')).dataset
      .slug;
    if (slug) navigateTo(slug);
  });

  document.getElementById('btn-locate')?.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Requesting device location…';
    announce('Requesting device location');
    const coords = await resolveBrowserGeolocation();
    if (coords) {
      const nearest = findNearestLocation(coords.lat, coords.lon, locations);
      if (nearest) {
        setLastLocation(nearest.slug);
        announce(`Located near ${nearest.name}`);
        navigateTo(nearest.slug);
        return;
      }
    }
    if (statusEl) statusEl.textContent = 'Device location unavailable. Trying IP geolocation…';
    await suggestFromIp(statusEl);
  });

  if (window.location.hash === '#/search') {
    document.getElementById('location-search')?.focus();
  } else {
    await suggestFromIp(statusEl);
  }
}

/**
 * Suggest a nearby site from IP without leaving the main page.
 * @param {HTMLElement | null} statusEl
 */
async function suggestFromIp(statusEl) {
  if (statusEl) statusEl.textContent = 'Detecting region from network…';
  announce('Detecting region');
  const ip = await resolveIpGeolocation();
  if (ip) {
    const nearest = findNearestLocation(ip.lat, ip.lon, locations);
    if (nearest) {
      if (statusEl) {
        statusEl.innerHTML = '';
        const text = document.createTextNode(`Near ${nearest.name} based on network location. `);
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-link';
        go.textContent = `Go to ${nearest.name}`;
        go.addEventListener('click', () => {
          setLastLocation(nearest.slug);
          navigateTo(nearest.slug);
        });
        statusEl.append(text, go);
      }
      announce(`Near ${nearest.name}. Choose Go to open that forecast.`);
      return;
    }
  }
  if (statusEl) statusEl.textContent = 'Could not detect your area automatically. Search below.';
  announce('Search for your city or ZIP code');
}

/**
 * @param {HTMLElement | null} panel
 */
function bindSearch(panel) {
  if (!panel) return;
  const input = /** @type {HTMLInputElement} */ (panel.querySelector('#location-search'));
  const results = panel.querySelector('#search-results');

  input?.addEventListener('input', () => {
    const hits = searchLocations(locations, zipTable, input.value);
    if (!results) return;
    results.innerHTML = '';
    hits.forEach((loc) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result-btn';
      btn.setAttribute('role', 'option');
      btn.textContent = `${loc.name}${loc.county ? ` · ${loc.county} County` : ''}`;
      btn.addEventListener('click', () => {
        setLastLocation(loc.slug);
        navigateTo(loc.slug);
      });
      li.appendChild(btn);
      results.appendChild(li);
    });
  });
}

/**
 * @param {HTMLElement | null} listEl
 */
function renderFavoritesList(listEl) {
  if (!listEl) return;
  const favs = getFavoriteLocations(locations, getFavorites());
  listEl.innerHTML = '';
  if (!favs.length) {
    listEl.innerHTML = '<li class="empty-state">Star a location to save it here.</li>';
    return;
  }
  favs.forEach((loc) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/l/${loc.slug}`;
    a.textContent = loc.name;
    li.appendChild(a);
    listEl.appendChild(li);
  });
}

/**
 * @param {string} slug
 */
async function renderLocationView(slug) {
  if (!els.main) return;

  const indexEntry = findLocation(slug);
  if (!indexEntry) {
    els.main.innerHTML = `
      <section class="error-card">
        <h1>Location not found</h1>
        <p>No site named “${slug}” in the index.</p>
        <a class="btn btn-primary" href="#/" data-nav-home>Back to home</a>
      </section>
    `;
    announce('Location not found');
    return;
  }

  setLastLocation(slug);
  els.main.innerHTML = '<p class="loading" aria-live="polite">Loading weather data…</p>';
  announce(`Loading weather for ${indexEntry.name}`);

  let payload;
  try {
    payload = await fetchJson(`locations/${slug}.json`);
  } catch {
    els.main.innerHTML = `
      <section class="error-card">
        <h1>Data unavailable</h1>
        <p>Could not load weather data for ${indexEntry.name}.</p>
        <a class="btn btn-primary" href="#/" data-nav-home>Try another location</a>
      </section>
    `;
    showError(`Failed to load weather data for ${indexEntry.name}.`);
    announce('Weather data failed to load', 'assertive');
    return;
  }

  els.main.innerHTML = `
    <p class="location-nav">
      <a class="btn btn-secondary" href="#/" data-nav-home>← All locations</a>
    </p>
    <div id="dashboard-root"></div>
  `;

  const dashRoot = document.getElementById('dashboard-root');
  if (!dashRoot) return;

  const syncFavorite = (s) => {
    const starred = toggleFavorite(s);
    renderFavoritesList(null);
    return starred;
  };

  renderDashboard(
    dashRoot,
    /** @type {Record<string, unknown>} */ (payload),
    syncFavorite,
    isFavorite(slug),
  );

  const mapContainer = /** @type {HTMLElement | null} */ (document.getElementById('map-container'));
  const mapControls = /** @type {HTMLElement | null} */ (
    document.querySelector('#map-slot .map-controls')
  );
  if (!mapContainer || !mapControls) return;

  initStateMap(mapContainer, locations, slug, (s) => navigateTo(s), {
    loadAlerts: true,
    alertsUrl: `${DATA_BASE}/alerts.geojson`,
    fixedView: true,
    onAlertsError: (msg) => {
      announce(`Alert map unavailable: ${msg}`);
    },
  });
  bindRadarControls(
    mapControls,
    async (enabled, opacity) => {
      const ok = await setRadarOverlay(enabled, opacity);
      if (enabled && !ok) {
        announce('RainViewer radar could not load; map basemap is still available.');
        const toggle = /** @type {HTMLInputElement | null} */ (
          document.getElementById('radar-toggle')
        );
        if (toggle) toggle.checked = false;
      }
    },
    { defaultOn: true },
  );

  announce(`Showing weather for ${indexEntry.name}`);
  document.title = `${indexEntry.name} — COWX`;
}

/**
 * Route handler.
 * `#/` and `#/search` always show the main find-location page (no auto-redirect).
 */
async function handleRoute() {
  showError(null);
  const slug = parseRoute();

  if (slug) {
    await renderLocationView(slug);
    return;
  }

  document.title = 'COWX — Colorado Weather';
  await renderResolveView();
}

async function init() {
  els.status = document.getElementById('status-announcer');
  els.errorBanner = document.getElementById('error-banner');
  els.main = document.getElementById('main-content');
  els.updatedFooter = document.getElementById('data-updated');

  await loadCoreData();
  bindHomeNavigation();
  window.addEventListener('hashchange', () => handleRoute());
  await handleRoute();
}

init();
