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
  } else {
    window.location.hash = '#/';
  }
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
 */
async function renderResolveView() {
  if (!els.main) return;
  destroyMap();

  els.main.innerHTML = `
    <section class="resolve-card" aria-labelledby="resolve-heading">
      <h1 id="resolve-heading">Find your Colorado weather</h1>
      <p class="lead">We use your last visit, device location, or IP region to pick the nearest site.</p>
      <div class="resolve-actions">
        <button type="button" class="btn btn-primary" id="btn-locate">Locate me</button>
        <a class="btn btn-secondary" href="#/search">Search instead</a>
      </div>
      <p class="resolve-status" id="resolve-status" aria-live="polite"></p>
    </section>
    <section class="search-panel" id="search-panel" hidden aria-labelledby="search-heading">
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
  const searchPanel = document.getElementById('search-panel');

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
    await tryIpResolve(statusEl, searchPanel);
  });

  if (window.location.hash === '#/search') {
    searchPanel?.removeAttribute('hidden');
    document.getElementById('location-search')?.focus();
  } else {
    await tryIpResolve(statusEl, searchPanel);
  }
}

/**
 * @param {HTMLElement | null} statusEl
 * @param {HTMLElement | null} searchPanel
 */
async function tryIpResolve(statusEl, searchPanel) {
  if (statusEl) statusEl.textContent = 'Detecting region from network…';
  announce('Detecting region');
  const ip = await resolveIpGeolocation();
  if (ip) {
    const nearest = findNearestLocation(ip.lat, ip.lon, locations);
    if (nearest) {
      setLastLocation(nearest.slug);
      if (statusEl) statusEl.textContent = `Near ${nearest.name} based on network location.`;
      announce(`Showing weather near ${nearest.name}`);
      navigateTo(nearest.slug);
      return;
    }
  }
  if (statusEl) statusEl.textContent = 'Could not detect your area automatically.';
  searchPanel?.removeAttribute('hidden');
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
        <a class="btn btn-primary" href="#/">Back to home</a>
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
        <a class="btn btn-primary" href="#/">Try another location</a>
      </section>
    `;
    showError(`Failed to load weather data for ${indexEntry.name}.`);
    announce('Weather data failed to load', 'assertive');
    return;
  }

  els.main.innerHTML = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="#/">Colorado</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${indexEntry.name}</span>
    </nav>
    <div id="dashboard-root"></div>
    <section class="map-section" aria-labelledby="map-heading">
      <h2 id="map-heading">Statewide map</h2>
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

  initStateMap(
    /** @type {HTMLElement} */ (document.getElementById('map-container')),
    locations,
    slug,
    (s) => navigateTo(s),
  );
  bindRadarControls(
    /** @type {HTMLElement} */ (document.querySelector('.map-section .map-controls')),
    (enabled, opacity) => setRadarOverlay(enabled, opacity),
  );

  announce(`Showing weather for ${indexEntry.name}`);
  document.title = `${indexEntry.name} — COWX`;
}

/**
 * Route handler.
 */
async function handleRoute() {
  showError(null);
  const slug = parseRoute();

  if (slug) {
    await renderLocationView(slug);
    return;
  }

  document.title = 'COWX — Colorado Weather';
  const preferred = getPreferredSlug();
  if (preferred && findLocation(preferred)) {
    navigateTo(preferred);
    return;
  }

  await renderResolveView();
}

async function init() {
  els.status = document.getElementById('status-announcer');
  els.errorBanner = document.getElementById('error-banner');
  els.main = document.getElementById('main-content');
  els.updatedFooter = document.getElementById('data-updated');

  await loadCoreData();
  window.addEventListener('hashchange', () => handleRoute());
  await handleRoute();
}

init();
