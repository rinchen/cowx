/**
 * Dual-pane locality workspace (Option D).
 */

import { renderDeepForecast } from './dashboard.js';
import { escapeHtml, jumpToSection } from './dom.js';
import { renderIntel } from './intel.js';
import { bindRadarLoopControls, destroyMap, initStateMap, setAqiLayer } from './map.js';

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
 * }} options
 * @returns {Promise<{ headline: string, destroy: () => void }>}
 */
export async function renderWorkspace(root, data, options) {
  const slug = String(data.slug ?? '');
  const name = String(data.name ?? slug);
  destroyMap();

  root.innerHTML = `
    <div class="workspace" id="workspace">
      <header class="workspace__header glass-panel glass-panel--header">
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
          <a class="btn btn-secondary btn-sm" href="#/" data-nav-home>All locations</a>
        </div>
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
            <div id="map-container" class="map-container map-container--workspace"></div>
            <p id="radar-status" class="intel-muted" hidden></p>
          </details>
        </div>
        <div class="workspace__intel" id="workspace-intel"></div>
      </div>
      <div class="workspace__deep glass-panel glass-panel--deep" id="workspace-deep"></div>
    </div>
  `;

  const intelRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-intel'));
  const deepRoot = /** @type {HTMLElement} */ (root.querySelector('#workspace-deep'));
  const mapContainer = /** @type {HTMLElement} */ (root.querySelector('#map-container'));
  const radarControls = /** @type {HTMLElement} */ (root.querySelector('#radar-controls'));

  const { headline } = renderIntel(intelRoot, data, { onJump: jumpToSection });

  renderDeepForecast(deepRoot, data, {
    sources: options.sources ?? [],
    includeMapSlot: false,
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
      destroyMap();
    },
  };
}
