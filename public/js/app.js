import { findNearestLocation, resolveBrowserGeolocation, resolveIpGeolocation } from './geo.js';
import {
  getFavorites,
  getPreferredSlug,
  isFavorite,
  setLastLocation,
  toggleFavorite,
} from './favorites.js';
import { getFavoriteLocations, searchLocations } from './search.js';
import { renderWorkspace } from './workspace.js';
import { destroyMap } from './map.js';

/** @typedef {{ slug: string; name: string; lat: number; lon: number; county?: string; aqi?: number | null }} IndexEntry */
/** @typedef {{ city: string; county: string; slug: string }} ZipEntry */

const DATA_BASE = 'data';
/** Poll interval for new fetch snapshots (scheduled fetch is ~45 min). */
const DATA_POLL_MS = 90_000;

/** @type {IndexEntry[]} */
let locations = [];
/** @type {ZipEntry[] | Record<string, ZipEntry>} */
let zipTable = [];
/** @type {Record<string, unknown> | null} */
let meta = null;
/** @type {string | null} */
let knownDataVersion = null;
/** @type {ReturnType<typeof setInterval> | null} */
let dataPollTimer = null;
let refreshInFlight = false;

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
 * @param {{ bustCache?: boolean }} [opts]
 * @returns {Promise<unknown>}
 */
async function fetchJson(path, opts = {}) {
  const bust = opts.bustCache ? `?_=${Date.now()}` : '';
  const response = await fetch(`${DATA_BASE}/${path}${bust}`, {
    cache: opts.bustCache ? 'no-store' : 'default',
  });
  if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
  return response.json();
}

/**
 * Stable snapshot id from meta.json (fetch build time). Prefer generatedAt so
 * client poll and known version stay aligned even when index.updated_at is copied in.
 * @param {Record<string, unknown> | null} m
 * @returns {string | null}
 */
function dataVersionFromMeta(m) {
  if (!m) return null;
  const v = m.generatedAt ?? m.updated_at;
  return v != null ? String(v) : null;
}

/**
 * Load core datasets. Partial failure surfaces banner but keeps UI usable.
 * @param {{ bustCache?: boolean }} [opts]
 */
async function loadCoreData(opts = {}) {
  const errors = [];
  const bust = Boolean(opts.bustCache);

  try {
    meta = /** @type {Record<string, unknown>} */ (
      await fetchJson('meta.json', { bustCache: bust })
    );
  } catch {
    errors.push('Could not load data freshness metadata.');
    meta = null;
  }

  try {
    const index = /** @type {{ locations?: IndexEntry[]; updated_at?: string } } */ (
      await fetchJson('index.json', { bustCache: bust })
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
    const zipsRaw = await fetchJson('co-zips.json', { bustCache: bust });
    zipTable = Array.isArray(zipsRaw)
      ? /** @type {ZipEntry[]} */ (zipsRaw)
      : /** @type {Record<string, ZipEntry>} */ (zipsRaw);
  } catch {
    errors.push('ZIP lookup table unavailable — search by ZIP disabled.');
    zipTable = [];
  }

  knownDataVersion = dataVersionFromMeta(meta);
  showError(errors.length ? errors.join(' ') : null);
  updateFooterTimestamp();
}

/**
 * Peek at meta.json without mutating app state.
 * @returns {Promise<string | null>}
 */
async function peekRemoteDataVersion() {
  try {
    const remote = /** @type {Record<string, unknown>} */ (
      await fetchJson('meta.json', { bustCache: true })
    );
    return dataVersionFromMeta(remote);
  } catch {
    return null;
  }
}

/**
 * When a newer fetch snapshot is published, reload core data and re-render.
 */
async function refreshIfDataUpdated() {
  if (refreshInFlight || document.visibilityState === 'hidden') return;
  refreshInFlight = true;
  try {
    const remoteVersion = await peekRemoteDataVersion();
    if (!remoteVersion || remoteVersion === knownDataVersion) return;

    announce('New weather data available. Refreshing…');
    await loadCoreData({ bustCache: true });
    await handleRoute({ bustCache: true });
    announce('Weather data updated.');
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Poll for newer public/data snapshots; pause while the tab is hidden.
 */
function startDataRefreshWatcher() {
  if (dataPollTimer) {
    clearInterval(dataPollTimer);
    dataPollTimer = null;
  }

  dataPollTimer = setInterval(() => {
    void refreshIfDataUpdated();
  }, DATA_POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshIfDataUpdated();
    }
  });
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
 * Logo / Home — preventDefault so navigation is explicit.
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
  const sourceIds = Array.isArray(meta?.sources)
    ? /** @type {{ id?: string; status?: string }[]} */ (meta.sources)
        .filter((s) => s?.status === 'ok' && s.id)
        .map((s) => String(s.id))
    : [];
  const sourceLabels = {
    openmeteo: 'Open-Meteo',
    openmeteo_aq: 'Open-Meteo AQ',
    nws: 'NWS',
    coagmet: 'CoAgMET',
    aviation: 'AWC',
    purpleair: 'PurpleAir',
    airnow: 'AirNow',
    cdot: 'CDOT',
    cwop: 'CWOP/APRS',
  };
  const names = sourceIds
    .map((id) => sourceLabels[/** @type {keyof typeof sourceLabels} */ (id)] ?? id)
    .filter(Boolean);
  const unique = [...new Set(names)];
  const srcBit = unique.length ? ` · Sources: ${unique.join(', ')}` : '';
  els.updatedFooter.textContent = ts
    ? `Data updated ${formatTimestamp(String(ts))}${srcBit}`
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
  document.body.classList.remove('workspace-active');

  const preferred = getPreferredSlug();
  const preferredLoc = preferred ? findLocation(preferred) : null;

  els.main.innerHTML = `
    <section class="resolve-card resolve-card--compact" aria-labelledby="resolve-heading">
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
      <div class="search-inline" id="search-panel">
        <label class="sr-only" for="location-search">City, county, or ZIP</label>
        <input
          type="search"
          id="location-search"
          name="q"
          placeholder="City, county, or ZIP"
          autocomplete="off"
          enterkeyhint="search"
        />
        <ul id="search-results" class="search-results" role="listbox" aria-label="Search results"></ul>
      </div>
    </section>
    <section class="favorites-panel favorites-panel--compact" id="favorites-panel" aria-labelledby="favorites-heading" hidden>
      <h2 id="favorites-heading">Favorites</h2>
      <ul id="favorites-list" class="location-list"></ul>
    </section>
  `;

  renderFavoritesList(document.getElementById('favorites-list'));
  bindSearch(document.getElementById('search-panel'));

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
  const panel = listEl.closest('.favorites-panel');
  const favs = getFavoriteLocations(locations, getFavorites());
  listEl.innerHTML = '';
  if (!favs.length) {
    if (panel) panel.hidden = true;
    return;
  }
  if (panel) panel.hidden = false;
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
 * @param {{ bustCache?: boolean }} [opts]
 */
async function renderLocationView(slug, opts = {}) {
  if (!els.main) return;

  const indexEntry = findLocation(slug);
  if (!indexEntry) {
    document.body.classList.remove('workspace-active');
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
    payload = await fetchJson(`locations/${slug}.json`, { bustCache: Boolean(opts.bustCache) });
  } catch {
    document.body.classList.remove('workspace-active');
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

  els.main.innerHTML = `<div id="workspace-root"></div>`;
  const wsRoot = document.getElementById('workspace-root');
  if (!wsRoot) return;

  document.body.classList.add('workspace-active');

  const { headline } = renderWorkspace(wsRoot, /** @type {Record<string, unknown>} */ (payload), {
    locations,
    starred: isFavorite(slug),
    onFavoriteToggle: (s) => {
      const starred = toggleFavorite(s);
      renderFavoritesList(null);
      return starred;
    },
    sources: Array.isArray(meta?.sources) ? /** @type {unknown[]} */ (meta.sources) : [],
    onAnnounce: announce,
    dataBase: DATA_BASE,
  });

  announce(`Showing weather for ${indexEntry.name}. ${headline}`);
  document.title = `${indexEntry.name} — COWX`;
}

/**
 * Route handler.
 * `#/` and `#/search` always show the main find-location page (no auto-redirect).
 * @param {{ bustCache?: boolean }} [opts]
 */
async function handleRoute(opts = {}) {
  showError(null);
  const slug = parseRoute();

  if (slug) {
    await renderLocationView(slug, opts);
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
  startDataRefreshWatcher();
}

init();
