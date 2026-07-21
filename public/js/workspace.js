/**
 * Dual-pane locality workspace: sticky-free radar | Hero,
 * then full-width Short-Term Outlook, specialty intel, and deep forecast.
 */

import { renderDeepForecast } from './dashboard.js';
import { escapeHtml, jumpToSection } from './dom.js';
import { getHyperlocalPin, pinDistanceKm } from './geo.js';
import { buildHyperlocalOverlay } from './hyperlocal.js';
import { renderHero, renderOutlook, renderSpecialtyIntel } from './intel.js';
import { bindRadarLoopControls, destroyMap, initStateMap, setAqiLayer } from './map.js';

/**
 * Load statewide space-weather snapshot (planetary; shared for all locations).
 * Failure point: file missing or network error.
 * Fallback: null — ham panels hide gracefully.
 * @param {string} dataBase
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function loadSpaceWeather(dataBase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${dataBase}/space-weather.json`, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   locations: { slug: string, name: string, lat: number, lon: number, county?: string }[],
 *   onFavoriteToggle: (slug: string) => boolean,
 *   starred: boolean,
 *   sources?: unknown[],
 *   onAnnounce?: (msg: string) => void,
 *   dataBase?: string,
 *   pin?: import('./geo.js').HyperlocalPin | null,
 * }} options
 * @returns {Promise<{ headline: string, destroy: () => void }>}
 */
export async function renderWorkspace(root, data, options) {
  const slug = String(data.slug ?? '');
  const name = String(data.name ?? slug);
  destroyMap();

  const pin = options.pin ?? getHyperlocalPin();
  const catalogDistKm = pinDistanceKm(pin, data);
  const dataBase = options.dataBase ?? 'data';

  const [hyperlocalResult, spaceWeather] = await Promise.all([
    pin
      ? buildHyperlocalOverlay(pin, { dataBase }).catch((err) => {
          console.warn('hyperlocal overlay failed', err);
          options.onAnnounce?.('Could not refine cameras for your pin; showing catalog nearest.');
          return null;
        })
      : Promise.resolve(null),
    loadSpaceWeather(dataBase),
  ]);
  const hyperlocal = hyperlocalResult;

  const pinSourceLabel =
    pin?.source === 'gps' ? 'GPS' : pin?.source === 'address' ? 'address' : 'network';
  const pinNote = pin
    ? `<p class="workspace__pin" role="status">
        <strong>${escapeHtml(pinSourceLabel)} pin</strong>
        ${catalogDistKm != null ? ` · ${catalogDistKm} km from catalog` : ''}
        ${
          pin.accuracy_m != null && pin.accuracy_m < 5000
            ? ` · ±${Math.round(pin.accuracy_m)} m`
            : ''
        }
        ${pin.label ? ` · <span class="workspace__pin-label">${escapeHtml(pin.label)}</span>` : ''}
      </p>`
    : '';

  root.innerHTML = `
    <div class="workspace" id="workspace">
      <header class="workspace__header glass-panel glass-panel--header">
        <div class="workspace__header-main">
          <div class="workspace__title-block">
            <h1 id="location-name">${escapeHtml(name)}</h1>
            <p class="location-meta">
              ${data.county ? `<span>${escapeHtml(String(data.county))} County</span>` : ''}
              ${data.elevation_ft != null ? `<span>${Number(data.elevation_ft).toLocaleString()} ft</span>` : ''}
              ${data.region ? `<span>${escapeHtml(String(data.region))}</span>` : ''}
              ${data.wfo ? `<span>NWS ${escapeHtml(String(data.wfo))}</span>` : ''}
              ${data.lat != null && data.lon != null ? `<span>${Number(data.lat).toFixed(2)}, ${Number(data.lon).toFixed(2)}</span>` : ''}
            </p>
          </div>
          <div class="workspace__actions">
            <button type="button" class="btn-favorite" id="btn-favorite" aria-pressed="${options.starred}" aria-label="${options.starred ? 'Remove from favorites' : 'Add to favorites'}">
              <span aria-hidden="true">${options.starred ? '★' : '☆'}</span>
            </button>
            <a class="btn btn-secondary btn-sm" href="#/refine">Refine location</a>
            <a class="btn btn-secondary btn-sm" href="#/" data-nav-home>All locations</a>
          </div>
        </div>
        ${pinNote}
      </header>
      ${
        data.forecastStale
          ? `<p class="stale-banner" role="status">Showing last successful forecast — a newer model pull was rate-limited.</p>`
          : ''
      }
      <div class="workspace__grid">
        <div class="workspace__map glass-panel glass-panel--map">
          <details class="workspace-map-details" open>
            <summary>Map &amp; radar</summary>
            <div class="map-controls map-controls--loop" id="radar-controls">
              <button type="button" class="btn btn-secondary btn-sm" id="radar-play" aria-pressed="false">Play</button>
              <label class="opacity-label" for="radar-scrub">
                Frame
                <input type="range" id="radar-scrub" min="0" max="0" value="0" />
              </label>
              <span id="radar-time" class="radar-time" aria-live="polite"></span>
              <label class="opacity-label" for="radar-speed">
                Speed
                <select id="radar-speed">
                  <option value="0.5">0.5×</option>
                  <option value="1" selected>1×</option>
                  <option value="2">2×</option>
                </select>
              </label>
              <label class="opacity-label" for="radar-opacity">
                Opacity
                <input type="range" id="radar-opacity" min="10" max="90" value="55" />
              </label>
              <label class="checkbox-label">
                <input type="checkbox" id="aqi-toggle" />
                Air quality
              </label>
            </div>
            <div id="map-container" class="map-container map-container--workspace" tabindex="-1"></div>
            <p id="radar-status" class="intel-muted" hidden></p>
          </details>
        </div>
        <div class="workspace__primary" id="workspace-primary">
          <div id="workspace-hero"></div>
        </div>
      </div>
      <div id="workspace-outlook" class="workspace__outlook"></div>
      <div class="workspace__specialty" id="workspace-specialty"></div>
      <div class="workspace__deep glass-panel glass-panel--deep" id="workspace-deep"></div>
    </div>
  `;

  const heroRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-hero'));
  const outlookRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-outlook'));
  const specialtyRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-specialty'));
  const deepRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-deep'));
  const mapContainer = /** @type {HTMLElement} */ (root.querySelector('#map-container'));
  const radarControls = /** @type {HTMLElement} */ (root.querySelector('#radar-controls'));

  /** @type {(() => void) | null} */
  let destroyOutlook = null;

  const { headline, destroy: destroyHero } = renderHero(heroRoot, data, {
    onJump: jumpToSection,
    pin,
    hyperlocal,
    spaceWeather,
    sources: options.sources ?? [],
  });

  const outlookApi = renderOutlook(outlookRoot, data, {
    onJump: jumpToSection,
    spaceWeather,
  });
  destroyOutlook = outlookApi.destroy;

  renderSpecialtyIntel(specialtyRoot, data, {
    onJump: jumpToSection,
    pin,
    hyperlocal,
    spaceWeather,
  });

  renderDeepForecast(deepRoot, data, {
    sources: options.sources ?? [],
    includeMapSlot: false,
    spaceWeather,
    hourlyCollapsed: true,
    dailyCollapsed: true,
  });

  const favBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#btn-favorite'));
  favBtn?.addEventListener('click', () => {
    const next = options.onFavoriteToggle(slug);
    favBtn.setAttribute('aria-pressed', String(next));
    favBtn.setAttribute('aria-label', next ? 'Remove from favorites' : 'Add to favorites');
    const span = favBtn.querySelector('span');
    if (span) span.textContent = next ? '★' : '☆';
  });

  initStateMap(mapContainer, options.locations, slug, () => {}, {
    loadAlerts: true,
    alertsUrl: `${options.dataBase ?? 'data'}/alerts.geojson`,
    fixedView: true,
    showMarkers: false,
    onAlertsError: (msg) => options.onAnnounce?.(`Alert map unavailable: ${msg}`),
  });

  const radarOk = await bindRadarLoopControls(radarControls, {
    defaultOn: true,
    onStatus: (msg) => {
      const status = root.querySelector('#radar-status');
      if (!(status instanceof HTMLElement)) return;
      if (!msg) {
        status.hidden = true;
        status.textContent = '';
        return;
      }
      status.hidden = false;
      status.textContent = msg;
      options.onAnnounce?.(msg);
    },
  });

  if (!radarOk) {
    options.onAnnounce?.('RainViewer radar could not load; map basemap is still available.');
  }

  const aqiToggle = /** @type {HTMLInputElement | null} */ (root.querySelector('#aqi-toggle'));
  aqiToggle?.addEventListener('change', () => {
    const ok = setAqiLayer(
      aqiToggle.checked,
      /** @type {{ slug: string, name: string, lat: number, lon: number, aqi?: number | null }[]} */ (
        options.locations
      ),
      slug,
    );
    if (aqiToggle.checked && !ok) {
      aqiToggle.checked = false;
      options.onAnnounce?.('Air quality markers unavailable for the catalog.');
    }
  });

  return {
    headline,
    destroy: () => {
      destroyHero();
      destroyOutlook?.();
      destroyMap();
    },
  };
}
