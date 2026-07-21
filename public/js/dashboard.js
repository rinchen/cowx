import { escapeHtml, safeHttpsUrl, safeExternalUrl } from './dom.js';
import { aqiBarHtml } from './aqi.js';
import { climatologyPeriodLabel, compareDailyToNormal, formatTempDelta } from './climatology.js';
import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { imageryUrls } from './imagery.js';
import { windCellHtml } from './wind.js';

const COL_PREF_KEY = 'cowx:tableColumns';

/** @type {string[]} */
const DEFAULT_HIDDEN_OPTIONAL = [
  'snow',
  'cloudLayers',
  'cape',
  'freeze',
  'wind80',
  'precipHours',
  'daylight',
  'et0',
];

/**
 * @returns {Record<string, boolean>}
 */
function loadColumnPrefs() {
  try {
    const raw = localStorage.getItem(COL_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, boolean>} prefs
 */
function saveColumnPrefs(prefs) {
  try {
    localStorage.setItem(COL_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {HTMLElement} wrap — table-scroll wrapper with data-table-kind
 * @param {{ key: string, label: string, optional?: boolean }[]} cols
 */
function attachColumnToggles(wrap, cols) {
  const optional = cols.filter((c) => c.optional);
  if (!optional.length) return;

  const prefs = loadColumnPrefs();
  const kind = wrap.dataset.tableKind || 'table';

  for (const col of optional) {
    const prefKey = `${kind}:${col.key}`;
    const visible =
      prefs[prefKey] != null ? Boolean(prefs[prefKey]) : !DEFAULT_HIDDEN_OPTIONAL.includes(col.key);
    if (!visible) wrap.classList.add(`hide-col-${col.key}`);
  }

  const details = document.createElement('details');
  details.className = 'column-toggles';
  const summary = document.createElement('summary');
  summary.textContent = 'Columns';
  details.appendChild(summary);
  const list = document.createElement('div');
  list.className = 'column-toggles__list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Optional forecast columns');

  for (const col of optional) {
    const prefKey = `${kind}:${col.key}`;
    const id = `col-toggle-${kind}-${col.key}`;
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.setAttribute('for', id);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !wrap.classList.contains(`hide-col-${col.key}`);
    input.addEventListener('change', () => {
      wrap.classList.toggle(`hide-col-${col.key}`, !input.checked);
      const next = loadColumnPrefs();
      next[prefKey] = input.checked;
      saveColumnPrefs(next);
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${col.label}`));
    list.appendChild(label);
  }
  details.appendChild(list);
  wrap.insertBefore(details, wrap.firstChild);
}

/**
 * Secondary precip-type line for an hourly row.
 * @param {number | null | undefined} rain
 * @param {number | null | undefined} showers
 * @param {number | null | undefined} snow
 * @returns {string}
 */
function precipTypeLine(rain, showers, snow) {
  const r = rain != null ? Number(rain) : null;
  const sh = showers != null ? Number(showers) : null;
  const s = snow != null ? Number(snow) : null;
  if (r == null && sh == null && s == null) return '';
  const rainTotal = (r ?? 0) + (sh ?? 0);
  const snowVal = s ?? 0;
  const parts = [];
  if (rainTotal > 0 && snowVal > 0) parts.push('Mix');
  else if (snowVal > 0) parts.push(`Snow ${snowVal.toFixed(2)}`);
  else if (rainTotal > 0) parts.push(`Rain ${rainTotal.toFixed(2)}`);
  if (!parts.length) return '';
  return `<span class="precip-type">${escapeHtml(parts.join(' · '))}</span>`;
}
/**
 * @param {unknown} value
 */
function fmtTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

/**
 * @param {string} dateStr
 */
function fmtDate(dateStr) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${dateStr}T12:00:00`));
  } catch {
    return dateStr;
  }
}

/**
 * @param {string} iso
 */
function fmtDateTime(iso) {
  if (!iso) return '—';
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
 * @param {unknown} iso
 */
function fmtClock(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(String(iso)),
    );
  } catch {
    return String(iso);
  }
}

/**
 * @param {number | null | undefined} meters
 */
function fmtVisibility(meters) {
  if (meters == null || Number.isNaN(Number(meters))) return '—';
  const miles = Number(meters) / 1609.34;
  if (miles >= 10) return `${Math.round(miles)} mi`;
  return `${miles.toFixed(1)} mi`;
}

/**
 * @param {unknown} v
 */
function coagValue(v) {
  if (v == null || v === '' || v === -999 || v === '-999') return null;
  return v;
}

/**
 * @param {unknown} arr
 * @returns {boolean}
 */
function seriesHasValues(arr) {
  return Array.isArray(arr) && arr.some((v) => v != null && v !== '');
}

/**
 * @param {unknown} arr
 * @param {number} min
 * @returns {boolean}
 */
function seriesHasAbove(arr, min) {
  return Array.isArray(arr) && arr.some((v) => v != null && Number(v) > min);
}

/**
 * @param {number | null | undefined} meters
 * @returns {string | null}
 */
function fmtFreezingLevelFt(meters) {
  if (meters == null || Number.isNaN(Number(meters))) return null;
  return `${Math.round(Number(meters) * 3.28084).toLocaleString()} ft`;
}

/**
 * Format Open-Meteo duration seconds as "Xh Ym".
 * @param {number | null | undefined} seconds
 * @returns {string | null}
 */
function fmtDurationSeconds(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  const total = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Compact L/M/H cloud layer percentages.
 * @param {number | null | undefined} low
 * @param {number | null | undefined} mid
 * @param {number | null | undefined} high
 * @returns {string}
 */
function cloudLayersHtml(low, mid, high) {
  const fmt = (v) => (v != null && !Number.isNaN(Number(v)) ? `${Math.round(Number(v))}` : '—');
  return `<span class="cloud-layers" title="Low / Mid / High cloud cover %">${fmt(low)}/${fmt(mid)}/${fmt(high)}</span>`;
}

/**
 * Scroll to an on-page section without changing location.hash (SPA hash router).
 * Opens a parent &lt;details&gt; when the target lives in a collapsed section.
 * @param {string} id
 */
function jumpToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const details = target.closest('details');
  if (details) details.open = true;
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  if (typeof target.focus === 'function') {
    const hadTabindex = target.hasAttribute('tabindex');
    if (!hadTabindex) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (!hadTabindex) {
      target.addEventListener(
        'blur',
        () => {
          target.removeAttribute('tabindex');
        },
        { once: true },
      );
    }
  }
}

/**
 * @param {ParentNode} root
 */
function bindDetailJumps(root) {
  root.querySelectorAll('a.detail-jump[data-jump-to]').forEach((node) => {
    const a = /** @type {HTMLAnchorElement} */ (node);
    a.addEventListener('click', (event) => {
      const id = a.getAttribute('data-jump-to');
      if (!id) return;
      event.preventDefault();
      jumpToSection(id);
    });
  });
}

/**
 * @param {unknown} sources
 * @param {string} id
 * @returns {{ fetchedAt: string | null, status: string | null }}
 */
function metaSourceInfo(sources, id) {
  if (!Array.isArray(sources)) return { fetchedAt: null, status: null };
  const hit = sources.find((s) => s && typeof s === 'object' && s.id === id);
  if (!hit) return { fetchedAt: null, status: null };
  const rec = /** @type {Record<string, unknown>} */ (hit);
  return {
    fetchedAt: typeof rec.fetchedAt === 'string' ? rec.fetchedAt : null,
    status: typeof rec.status === 'string' ? rec.status : null,
  };
}

/**
 * @param {string | null} status
 * @returns {string}
 */
function sourceStatusNote(status) {
  if (!status || status === 'ok') return '';
  return ` · last pull: ${status}`;
}

/**
 * @param {unknown} observed
 * @returns {string | null}
 */
function fmtObserved(observed) {
  if (observed == null || observed === '') return null;
  if (typeof observed === 'number') {
    const ms = observed > 1e12 ? observed : observed * 1000;
    return fmtDateTime(new Date(ms).toISOString());
  }
  const s = String(observed);
  // AirNow often sends "YYYY-MM-DD HH"
  if (/^\d{4}-\d{2}-\d{2} \d{1,2}$/.test(s)) {
    try {
      return fmtDateTime(`${s.replace(' ', 'T')}:00:00`);
    } catch {
      return s;
    }
  }
  return fmtDateTime(s);
}

/**
 * Live source references for this locality snapshot (collapsed by default).
 * @param {HTMLElement} parent
 * @param {Record<string, unknown>} data
 * @param {unknown[]} [metaSources]
 */
function renderLiveSourcesPanel(parent, data, metaSources = []) {
  const links = /** @type {Record<string, string | null>} */ (data.links ?? {});
  const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
  const purpleair = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
  const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
  const coag = /** @type {Record<string, unknown> | null} */ (data.coagmet ?? null);
  const aviation = /** @type {Record<string, unknown> | null} */ (data.aviation ?? null);
  const usgs = /** @type {Record<string, unknown> | null} */ (data.usgs ?? null);
  const snotel = /** @type {Record<string, unknown> | null} */ (data.snotel ?? null);
  const afd = /** @type {Record<string, unknown> | null} */ (data.afd ?? null);
  const hwo = /** @type {Record<string, unknown> | null} */ (data.hwo ?? null);
  const alerts = /** @type {unknown[]} */ (data.alerts ?? []);

  /** @type {{ title: string, body: string, href: string | null }[]} */
  const rows = [];

  const omInfo = metaSourceInfo(metaSources, 'openmeteo');
  const omWhen = omInfo.fetchedAt ?? data.updatedAt;
  rows.push({
    title: 'Forecast & current conditions',
    body: `${data.forecastStale ? 'Open-Meteo (stale carry-forward)' : 'Open-Meteo model'} · snapshot ${omWhen ? fmtDateTime(String(omWhen)) : 'time unknown'}${sourceStatusNote(omInfo.status)}`,
    href: 'https://open-meteo.com/',
  });

  const nwsInfo = metaSourceInfo(metaSources, 'nws');
  rows.push({
    title: 'Alerts & forecast discussion',
    body: `National Weather Service${alerts.length ? ` · ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}` : ' · no active alerts'}${afd?.office ? ` · AFD ${afd.office}` : ''}${hwo?.office ? ` · HWO ${hwo.office}` : ''}${afd?.issued ? ` issued ${fmtDateTime(String(afd.issued))}` : ''}${nwsInfo.fetchedAt ? ` · fetched ${fmtDateTime(nwsInfo.fetchedAt)}` : ''}${sourceStatusNote(nwsInfo.status)}`,
    href: links.nws_forecast || 'https://www.weather.gov/',
  });

  if (airnow || purpleair || omaq) {
    const bits = [];
    if (airnow?.aqi != null) {
      bits.push(
        `AirNow AQI ${airnow.aqi}${airnow.observed ? ` (observed ${fmtObserved(airnow.observed) ?? airnow.observed})` : ''}`,
      );
    }
    if (purpleair?.aqi_pm25 != null) {
      bits.push(`PurpleAir est. AQI ${purpleair.aqi_pm25}`);
    }
    if (omaq?.us_aqi != null) {
      bits.push(`Open-Meteo model US AQI ${omaq.us_aqi}`);
    }
    const primaryAq = airnow
      ? metaSourceInfo(metaSources, 'airnow')
      : purpleair
        ? metaSourceInfo(metaSources, 'purpleair')
        : metaSourceInfo(metaSources, 'openmeteo_aq');
    rows.push({
      title: 'Air quality',
      body: `${bits.join(' · ')}${primaryAq.fetchedAt ? ` · fetched ${fmtDateTime(primaryAq.fetchedAt)}` : ''}${sourceStatusNote(primaryAq.status)}`,
      href: airnow?.url
        ? String(airnow.url)
        : purpleair?.url
          ? String(purpleair.url)
          : links.airnow || 'https://www.airnow.gov/',
    });
  }

  if (coag) {
    const coagInfo = metaSourceInfo(metaSources, 'coagmet');
    rows.push({
      title: 'Agriculture (CoAgMET)',
      body: `${coag.station_name ?? coag.station_id}${coag.distance_km != null ? ` · ${coag.distance_km} km away` : ''}${coagInfo.fetchedAt ? ` · fetched ${fmtDateTime(coagInfo.fetchedAt)}` : ''}${sourceStatusNote(coagInfo.status)}`,
      href: coag.url ? String(coag.url) : links.coagmet || 'https://coagmet.colostate.edu/',
    });
  }

  if (aviation?.raw_metar) {
    const avInfo = metaSourceInfo(metaSources, 'aviation');
    const obs = fmtObserved(aviation.observed);
    rows.push({
      title: 'Aviation (METAR / TAF)',
      body: `${aviation.icao ?? 'Nearest station'}${aviation.flight_category ? ` · ${aviation.flight_category}` : ''}${obs ? ` · observed ${obs}` : ''}${avInfo.fetchedAt ? ` · fetched ${fmtDateTime(avInfo.fetchedAt)}` : ''}${sourceStatusNote(avInfo.status)}`,
      href: aviation.url ? String(aviation.url) : links.aviation || 'https://aviationweather.gov/',
    });
  }

  if (usgs) {
    const usgsInfo = metaSourceInfo(metaSources, 'usgs');
    rows.push({
      title: 'Hydrology (USGS)',
      body: `${usgs.station_name ?? usgs.station_id}${usgs.discharge_cfs != null ? ` · ${Math.round(Number(usgs.discharge_cfs))} cfs` : ''}${usgs.distance_km != null ? ` · ${usgs.distance_km} km` : ''}${usgsInfo.fetchedAt ? ` · fetched ${fmtDateTime(usgsInfo.fetchedAt)}` : ''}${sourceStatusNote(usgsInfo.status)}`,
      href: usgs.url ? String(usgs.url) : links.usgs || 'https://waterdata.usgs.gov/',
    });
  }

  if (snotel) {
    const snInfo = metaSourceInfo(metaSources, 'snotel');
    rows.push({
      title: 'Snowpack (SNOTEL)',
      body: `${snotel.station_name ?? snotel.station_id}${snotel.snow_depth_in != null ? ` · ${snotel.snow_depth_in} in depth` : ''}${snotel.distance_km != null ? ` · ${snotel.distance_km} km` : ''}${snInfo.fetchedAt ? ` · fetched ${fmtDateTime(snInfo.fetchedAt)}` : ''}${sourceStatusNote(snInfo.status)}`,
      href: snotel.url
        ? String(snotel.url)
        : links.snotel || 'https://www.nrcs.usda.gov/wps/portal/wcc/home/',
    });
  }

  rows.push({
    title: 'Radar overlay',
    body: 'RainViewer live tiles on the map above (refreshed from their public weather-maps API)',
    href: links.rainviewer || 'https://www.rainviewer.com/',
  });

  const pws = /** @type {Record<string, unknown> | null} */ (data.pws ?? null);
  const cwop = /** @type {Record<string, unknown> | null} */ (pws?.primary ?? data.cwop ?? null);
  if (cwop?.callsign) {
    const cwopInfo = metaSourceInfo(metaSources, 'cwop');
    rows.push({
      title: 'Nearby PWS (CWOP / APRS)',
      body: `${cwop.callsign}${cwop.distance_km != null ? ` · ${cwop.distance_km} km` : ''}${cwop.temp_f != null ? ` · ${Math.round(Number(cwop.temp_f))}°F` : ''}${cwopInfo.fetchedAt ? ` · fetched ${fmtDateTime(cwopInfo.fetchedAt)}` : ''}${sourceStatusNote(cwopInfo.status)}`,
      href:
        pws?.links &&
        typeof pws.links === 'object' &&
        /** @type {Record<string, unknown>} */ (pws.links).aprs
          ? String(/** @type {Record<string, unknown>} */ (pws.links).aprs)
          : links.pws || 'https://aprs.fi/',
    });
  } else if (links.pws) {
    rows.push({
      title: 'Personal weather station',
      body: 'Nearby WUnderground PWS dashboard (live observations offsite)',
      href: String(links.pws),
    });
  }

  const cdotRoads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
  const cdotCam = /** @type {Record<string, unknown> | null} */ (
    cdotRoads?.cameras?.[0] ?? data.cdot_camera ?? null
  );
  if (cdotCam || cdotRoads) {
    const cdotInfo = metaSourceInfo(metaSources, 'cdot');
    const camCount = Array.isArray(cdotRoads?.cameras) ? cdotRoads.cameras.length : cdotCam ? 1 : 0;
    rows.push({
      title: 'Roads & cameras (CDOT / COtrip)',
      body: `${camCount ? `${camCount} nearby camera${camCount === 1 ? '' : 's'}` : 'Road network'}${cdotCam?.name ? ` · ${cdotCam.name}` : ''}${cdotInfo.fetchedAt ? ` · fetched ${fmtDateTime(cdotInfo.fetchedAt)}` : ''}${sourceStatusNote(cdotInfo.status)}`,
      href: links.cotrip || 'https://maps.cotrip.org/',
    });
  }

  const webcamLinks = /** @type {{ name?: string, url?: string }[]} */ (links.webcam_links ?? []);
  if (webcamLinks.length) {
    rows.push({
      title: 'Local webcams',
      body: webcamLinks.map((w) => w.name || 'Webcam').join(' · '),
      href: webcamLinks[0]?.url ? String(webcamLinks[0].url) : null,
    });
  }

  renderCollapsibleSection(
    parent,
    'sources-heading',
    'Live data sources',
    () => {
      const wrap = document.createDocumentFragment();
      const lead = document.createElement('p');
      lead.className = 'sources-lead';
      lead.textContent =
        'This page is a Colorado snapshot refreshed about every 45 minutes. Values below name the upstream feed and when we last pulled it — open a link for the provider’s live product.';
      wrap.appendChild(lead);

      const ul = document.createElement('ul');
      ul.className = 'sources-list';
      ul.innerHTML = rows
        .map(
          (r) => `
        <li>
          <strong>${escapeHtml(r.title)}</strong>
          <span class="sources-body">${escapeHtml(r.body)}</span>
          ${
            r.href && (safeHttpsUrl(r.href) || safeExternalUrl(r.href))
              ? `<a href="${escapeHtml(safeHttpsUrl(r.href) || safeExternalUrl(r.href))}" target="_blank" rel="noopener noreferrer">Open source</a>`
              : ''
          }
        </li>`,
        )
        .join('');
      wrap.appendChild(ul);

      const footer = document.createElement('p');
      footer.className = 'sources-footer';
      footer.innerHTML = `Full attribution:
      <a href="credits.html">Credits</a>
      ·
      <a href="how-it-works.html">How it works</a>`;
      wrap.appendChild(footer);
      return wrap;
    },
    { open: false },
  );
}

/**
 * @param {string} href
 * @param {string} label
 * @param {string} [className]
 */
function sourceLink(href, label, className = 'btn btn-secondary btn-sm') {
  const safe = safeHttpsUrl(href);
  if (!safe) return '';
  return `<a class="${className}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/**
 * http or https offsite verify links (county OEM pages).
 * @param {string} href
 * @param {string} label
 * @param {string} [className]
 */
function externalVerifyLink(href, label, className = 'btn btn-secondary btn-sm') {
  const safe = safeExternalUrl(href);
  if (!safe) return '';
  return `<a class="${className}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/**
 * @param {HTMLElement} parent
 * @param {string} headingId
 * @param {string} title
 * @param {Node} body
 */
function renderForecastCard(parent, headingId, title, body) {
  const section = document.createElement('section');
  section.className = 'forecast-card';
  section.setAttribute('aria-labelledby', headingId);
  const h2 = document.createElement('h2');
  h2.id = headingId;
  h2.textContent = title;
  section.appendChild(h2);
  section.appendChild(body);
  parent.appendChild(section);
}

/**
 * @param {HTMLElement} parent
 * @param {string} headingId
 * @param {string} title
 * @param {() => (Node | null)} renderBody
 * @param {{ open?: boolean, actionsHtml?: string }} [opts]
 */
function renderCollapsibleSection(parent, headingId, title, renderBody, opts = {}) {
  const body = renderBody();
  if (body == null) return;

  const details = document.createElement('details');
  details.className = 'dash-section';
  details.open = opts.open !== false;
  const summary = document.createElement('summary');
  summary.id = headingId;
  const actionsHtml = opts.actionsHtml ?? '';
  summary.innerHTML = `<span class="dash-section-title">${escapeHtml(title)}</span>${actionsHtml ? `<span class="dash-section-actions">${actionsHtml}</span>` : ''}`;
  const actions = summary.querySelector('.dash-section-actions');
  actions?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  details.appendChild(summary);
  const content = document.createElement('div');
  content.className = 'dash-section-body';
  content.appendChild(body);
  details.appendChild(content);
  parent.appendChild(details);
}

/**
 * @param {DocumentFragment | HTMLElement} container
 * @param {string} title
 * @param {string} bodyHtml
 */
function renderEmpty(container, title, bodyHtml) {
  const el = document.createElement('p');
  el.className = 'empty-state';
  el.innerHTML = `<strong>${escapeHtml(title)}</strong> ${bodyHtml}`;
  container.appendChild(el);
}

/**
 * @param {Record<string, unknown>} hourly
 * @param {string[]} sunrises
 * @param {string[]} sunsets
 * @param {{ elevationFt?: number | null }} [opts]
 * @returns {HTMLElement}
 */
function buildHourlyTable(hourly, sunrises, sunsets, opts = {}) {
  const times = /** @type {string[]} */ (hourly.time).slice(0, 48);
  const elevationFt = opts.elevationFt ?? null;
  const showFeels = seriesHasValues(hourly.apparent_temperature);
  const showPrecipPct = seriesHasValues(hourly.precipitation_probability);
  const showPrecipIn = seriesHasValues(hourly.precipitation);
  const showSnow = seriesHasAbove(hourly.snowfall, 0);
  const showWind =
    seriesHasValues(hourly.wind_speed_10m) || seriesHasValues(hourly.wind_direction_10m);
  const showGust = seriesHasValues(hourly.wind_gusts_10m);
  const showWind80 =
    seriesHasValues(hourly.wind_speed_80m) || seriesHasValues(hourly.wind_direction_80m);
  const showTstorm = seriesHasValues(hourly.thunderstorm_probability);
  const showCape = seriesHasAbove(hourly.cape, 100);
  const showRh = seriesHasValues(hourly.relative_humidity_2m);
  const showDew = seriesHasValues(hourly.dewpoint_2m);
  const showCloud = seriesHasValues(hourly.cloud_cover);
  const showCloudLayers =
    seriesHasValues(hourly.cloud_cover_low) ||
    seriesHasValues(hourly.cloud_cover_mid) ||
    seriesHasValues(hourly.cloud_cover_high);
  const showUv = seriesHasValues(hourly.uv_index);
  const showVis = seriesHasValues(hourly.visibility);
  const showFreeze =
    elevationFt != null &&
    Number(elevationFt) > 8000 &&
    seriesHasValues(hourly.freezing_level_height);

  /** @type {{ key: string, label: string, optional?: boolean }[]} */
  const cols = [
    { key: 'time', label: 'Time' },
    { key: 'cond', label: 'Cond.' },
    { key: 'temp', label: 'Temp' },
  ];
  if (showFeels) cols.push({ key: 'feels', label: 'Feels' });
  if (showPrecipPct) cols.push({ key: 'precipPct', label: 'Precip %' });
  if (showPrecipIn) cols.push({ key: 'precipIn', label: 'Precip in' });
  if (showSnow) cols.push({ key: 'snow', label: 'Snow', optional: true });
  if (showWind) cols.push({ key: 'wind', label: 'Wind' });
  if (showGust) cols.push({ key: 'gust', label: 'Gust' });
  if (showWind80) cols.push({ key: 'wind80', label: 'Wind 80m', optional: true });
  if (showTstorm) cols.push({ key: 'tstorm', label: 'Tstorm %' });
  if (showCape) cols.push({ key: 'cape', label: 'CAPE', optional: true });
  if (showRh) cols.push({ key: 'rh', label: 'RH' });
  if (showDew) cols.push({ key: 'dew', label: 'Dew' });
  if (showCloud) cols.push({ key: 'cloud', label: 'Cloud' });
  if (showCloudLayers) cols.push({ key: 'cloudLayers', label: 'L/M/H', optional: true });
  if (showFreeze) cols.push({ key: 'freeze', label: 'Freeze lvl', optional: true });
  if (showUv) cols.push({ key: 'uv', label: 'UV' });
  if (showVis) cols.push({ key: 'vis', label: 'Vis' });

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.dataset.tableKind = 'hourly';
  const table = document.createElement('table');
  table.className = 'data-table data-table--dense data-table--forecast';
  table.innerHTML = `
    <caption class="sr-only">48-hour hourly forecast</caption>
    <thead><tr>${cols
      .map(
        (c) =>
          `<th scope="col" class="col-${escapeHtml(c.key)}${c.optional ? ' col-optional' : ''}" data-col="${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`,
      )
      .join('')}</tr></thead>
  `;
  const tbody = document.createElement('tbody');
  const isDaySeries = /** @type {(number | null)[]} */ (hourly.is_day ?? []);
  times.forEach((t, i) => {
    const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
    const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
    const feels = /** @type {number[]} */ (hourly.apparent_temperature ?? [])[i];
    const precipPct = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
    const precipIn = /** @type {number[]} */ (hourly.precipitation ?? [])[i];
    const snow = /** @type {number[]} */ (hourly.snowfall ?? [])[i];
    const wind = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
    const windDir = /** @type {number[]} */ (hourly.wind_direction_10m ?? [])[i];
    const gust = /** @type {number[]} */ (hourly.wind_gusts_10m ?? [])[i];
    const wind80 = /** @type {number[]} */ (hourly.wind_speed_80m ?? [])[i];
    const wind80Dir = /** @type {number[]} */ (hourly.wind_direction_80m ?? [])[i];
    const tstorm = /** @type {number[]} */ (hourly.thunderstorm_probability ?? [])[i];
    const cape = /** @type {number[]} */ (hourly.cape ?? [])[i];
    const rh = /** @type {number[]} */ (hourly.relative_humidity_2m ?? [])[i];
    const dew = /** @type {number[]} */ (hourly.dewpoint_2m ?? [])[i];
    const cloud = /** @type {number[]} */ (hourly.cloud_cover ?? [])[i];
    const cloudLow = /** @type {number[]} */ (hourly.cloud_cover_low ?? [])[i];
    const cloudMid = /** @type {number[]} */ (hourly.cloud_cover_mid ?? [])[i];
    const cloudHigh = /** @type {number[]} */ (hourly.cloud_cover_high ?? [])[i];
    const freeze = /** @type {number[]} */ (hourly.freezing_level_height ?? [])[i];
    const uv = /** @type {number[]} */ (hourly.uv_index ?? [])[i];
    const vis = /** @type {number[]} */ (hourly.visibility ?? [])[i];
    const rain = /** @type {number[]} */ (hourly.rain ?? [])[i];
    const showers = /** @type {number[]} */ (hourly.showers ?? [])[i];
    const dayFlag = isDaySeries[i];
    const day = dayFlag === 0 || dayFlag === 1 ? dayFlag === 1 : isDaytime(t, sunrises, sunsets);
    const precipType = precipTypeLine(rain, showers, snow);
    /** @type {Record<string, string>} */
    const cellByKey = {
      time: `<td class="sticky-col col-time" data-col="time">${escapeHtml(fmtTime(t))}</td>`,
      cond: `<td class="cond-cell col-cond" data-col="cond">${weatherIconHtml(code, { isDay: day, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span>${precipType}</td>`,
      temp: `<td class="col-temp" data-col="temp">${temp != null ? `${Math.round(temp)}°F` : '—'}</td>`,
      feels: `<td class="col-feels" data-col="feels">${feels != null ? `${Math.round(feels)}°F` : '—'}</td>`,
      precipPct: `<td class="col-precipPct" data-col="precipPct">${precipPct != null ? `${precipPct}%` : '—'}</td>`,
      precipIn: `<td class="col-precipIn" data-col="precipIn">${precipIn != null ? Number(precipIn).toFixed(2) : '—'}</td>`,
      snow: `<td class="col-snow" data-col="snow">${snow != null ? Number(snow).toFixed(2) : '—'}</td>`,
      wind: `<td class="wind-td col-wind" data-col="wind">${windCellHtml(windDir, wind, { size: 24 })}</td>`,
      gust: `<td class="col-gust" data-col="gust">${gust != null ? `${Math.round(gust)} mph` : '—'}</td>`,
      wind80: `<td class="wind-td col-wind80" data-col="wind80">${windCellHtml(wind80Dir, wind80, { size: 24 })}</td>`,
      tstorm: `<td class="col-tstorm" data-col="tstorm">${tstorm != null ? `${Math.round(Number(tstorm))}%` : '—'}</td>`,
      cape: `<td class="col-cape" data-col="cape">${cape != null ? `${Math.round(Number(cape))}` : '—'}</td>`,
      rh: `<td class="col-rh" data-col="rh">${rh != null ? `${rh}%` : '—'}</td>`,
      dew: `<td class="col-dew" data-col="dew">${dew != null ? `${Math.round(dew)}°F` : '—'}</td>`,
      cloud: `<td class="col-cloud" data-col="cloud">${cloud != null ? `${cloud}%` : '—'}</td>`,
      cloudLayers: `<td class="col-cloudLayers" data-col="cloudLayers">${cloudLayersHtml(cloudLow, cloudMid, cloudHigh)}</td>`,
      freeze: `<td class="col-freeze" data-col="freeze">${fmtFreezingLevelFt(freeze) ?? '—'}</td>`,
      uv: `<td class="col-uv" data-col="uv">${uv != null ? String(uv) : '—'}</td>`,
      vis: `<td class="col-vis" data-col="vis">${fmtVisibility(vis)}</td>`,
    };
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map((c) => cellByKey[c.key]).join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  attachColumnToggles(wrap, cols);
  return wrap;
}

/**
 * @param {Record<string, unknown>} daily
 * @param {Record<string, unknown> | null} [climatology]
 * @returns {HTMLElement}
 */
function buildDailyTable(daily, climatology = null) {
  const times = /** @type {string[]} */ (daily.time ?? []);
  const showFeels =
    seriesHasValues(daily.apparent_temperature_max) ||
    seriesHasValues(daily.apparent_temperature_min);
  const showTstorm = seriesHasValues(daily.thunderstorm_probability_max);
  const showSnow = seriesHasValues(daily.snowfall_sum);
  const showPrecipHours = seriesHasValues(daily.precipitation_hours);
  const showRh =
    seriesHasValues(daily.relative_humidity_2m_max) ||
    seriesHasValues(daily.relative_humidity_2m_min);
  const showDew = seriesHasValues(daily.dewpoint_2m_max) || seriesHasValues(daily.dewpoint_2m_min);
  const showCloud = seriesHasValues(daily.cloud_cover_mean);
  const showCape = seriesHasAbove(daily.cape_max, 100);
  const showVis = seriesHasValues(daily.visibility_min);
  const showSunshine = seriesHasValues(daily.sunshine_duration);
  const showDaylight = seriesHasValues(daily.daylight_duration);
  const showEt0 = seriesHasValues(daily.et0_fao_evapotranspiration);
  const showVsTypical = Boolean(climatology?.doy);

  /** @type {{ key: string, label: string, optional?: boolean }[]} */
  const cols = [
    { key: 'day', label: 'Day' },
    { key: 'cond', label: 'Cond.' },
    { key: 'high', label: 'High' },
    { key: 'low', label: 'Low' },
  ];
  if (showVsTypical) cols.push({ key: 'vsTypical', label: 'Vs typical' });
  if (showFeels) cols.push({ key: 'feels', label: 'Feels' });
  cols.push({ key: 'precipPct', label: 'Precip %' }, { key: 'precipIn', label: 'Precip in' });
  if (showSnow) cols.push({ key: 'snow', label: 'Snow', optional: true });
  if (showPrecipHours) cols.push({ key: 'precipHours', label: 'Precip hrs', optional: true });
  cols.push({ key: 'wind', label: 'Wind' }, { key: 'gust', label: 'Gust' });
  if (showTstorm) cols.push({ key: 'tstorm', label: 'Tstorm %' });
  if (showCape) cols.push({ key: 'cape', label: 'CAPE', optional: true });
  if (showRh) cols.push({ key: 'rh', label: 'RH' });
  if (showDew) cols.push({ key: 'dew', label: 'Dew' });
  if (showCloud) cols.push({ key: 'cloud', label: 'Cloud' });
  cols.push({ key: 'uv', label: 'UV' });
  if (showVis) cols.push({ key: 'vis', label: 'Vis' });
  if (showSunshine) cols.push({ key: 'sunshine', label: 'Sunshine', optional: true });
  if (showDaylight) cols.push({ key: 'daylight', label: 'Daylight', optional: true });
  if (showEt0) cols.push({ key: 'et0', label: 'ET₀', optional: true });
  cols.push({ key: 'sunrise', label: 'Sunrise' }, { key: 'sunset', label: 'Sunset' });

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.dataset.tableKind = 'daily';
  const table = document.createElement('table');
  table.className = 'data-table data-table--dense data-table--forecast';
  table.innerHTML = `
    <caption class="sr-only">10-day daily forecast</caption>
    <thead>
      <tr>
        ${cols
          .map(
            (c) =>
              `<th scope="col" class="col-${escapeHtml(c.key)}${c.optional ? ' col-optional' : ''}" data-col="${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`,
          )
          .join('')}
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  for (let i = 0; i < Math.min(10, times.length); i += 1) {
    const tr = document.createElement('tr');
    const hi = /** @type {number[]} */ (daily.temperature_2m_max ?? [])[i];
    const lo = /** @type {number[]} */ (daily.temperature_2m_min ?? [])[i];
    const feelsHi = /** @type {number[]} */ (daily.apparent_temperature_max ?? [])[i];
    const feelsLo = /** @type {number[]} */ (daily.apparent_temperature_min ?? [])[i];
    const precipPct = /** @type {number[]} */ (daily.precipitation_probability_max ?? [])[i];
    const precipSum = /** @type {number[]} */ (daily.precipitation_sum ?? [])[i];
    const snow = /** @type {number[]} */ (daily.snowfall_sum ?? [])[i];
    const precipHours = /** @type {number[]} */ (daily.precipitation_hours ?? [])[i];
    const windMax = /** @type {number[]} */ (daily.wind_speed_10m_max ?? [])[i];
    const windDir = /** @type {number[]} */ (daily.wind_direction_10m_dominant ?? [])[i];
    const gustMax = /** @type {number[]} */ (daily.wind_gusts_10m_max ?? [])[i];
    const tstormMax = /** @type {number[]} */ (daily.thunderstorm_probability_max ?? [])[i];
    const capeMax = /** @type {number[]} */ (daily.cape_max ?? [])[i];
    const rhMax = /** @type {number[]} */ (daily.relative_humidity_2m_max ?? [])[i];
    const rhMin = /** @type {number[]} */ (daily.relative_humidity_2m_min ?? [])[i];
    const dewMax = /** @type {number[]} */ (daily.dewpoint_2m_max ?? [])[i];
    const dewMin = /** @type {number[]} */ (daily.dewpoint_2m_min ?? [])[i];
    const cloudMean = /** @type {number[]} */ (daily.cloud_cover_mean ?? [])[i];
    const uvMax = /** @type {number[]} */ (daily.uv_index_max ?? [])[i];
    const visMin = /** @type {number[]} */ (daily.visibility_min ?? [])[i];
    const sunshine = /** @type {number[]} */ (daily.sunshine_duration ?? [])[i];
    const daylight = /** @type {number[]} */ (daily.daylight_duration ?? [])[i];
    const et0 = /** @type {number[]} */ (daily.et0_fao_evapotranspiration ?? [])[i];
    const code = /** @type {number[]} */ (daily.weather_code ?? [])[i];
    const rise = /** @type {string[]} */ (daily.sunrise ?? [])[i];
    const set = /** @type {string[]} */ (daily.sunset ?? [])[i];
    const iso = String(times[i]).slice(0, 10);
    const cmp = compareDailyToNormal(climatology, iso, hi, lo, precipSum);
    const vsHi = formatTempDelta(cmp.deltaHi);
    const vsLo = formatTempDelta(cmp.deltaLo);
    const vsLabel = vsHi && vsLo ? `${vsHi} / ${vsLo}` : vsHi || vsLo || '—';
    const feelsLabel =
      feelsHi != null && feelsLo != null
        ? `${Math.round(feelsHi)}° / ${Math.round(feelsLo)}°`
        : feelsHi != null
          ? `${Math.round(feelsHi)}°F`
          : feelsLo != null
            ? `${Math.round(feelsLo)}°F`
            : '—';
    const rhLabel =
      rhMax != null && rhMin != null
        ? `${Math.round(rhMax)}–${Math.round(rhMin)}%`
        : rhMax != null
          ? `${Math.round(rhMax)}%`
          : rhMin != null
            ? `${Math.round(rhMin)}%`
            : '—';
    const dewLabel =
      dewMax != null && dewMin != null
        ? `${Math.round(dewMax)}° / ${Math.round(dewMin)}°`
        : dewMax != null
          ? `${Math.round(dewMax)}°F`
          : dewMin != null
            ? `${Math.round(dewMin)}°F`
            : '—';
    /** @type {Record<string, string>} */
    const cellByKey = {
      day: `<td class="sticky-col col-day" data-col="day">${fmtDate(times[i])}</td>`,
      cond: `<td class="cond-cell col-cond" data-col="cond">${weatherIconHtml(code, { isDay: true, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>`,
      high: `<td class="col-high" data-col="high">${hi != null ? `${Math.round(hi)}°F` : '—'}</td>`,
      low: `<td class="col-low" data-col="low">${lo != null ? `${Math.round(lo)}°F` : '—'}</td>`,
      vsTypical: `<td class="col-vsTypical" data-col="vsTypical"><span class="vs-typical-cell">${escapeHtml(vsLabel)}</span></td>`,
      feels: `<td class="col-feels" data-col="feels">${feelsLabel}</td>`,
      precipPct: `<td class="col-precipPct" data-col="precipPct">${precipPct != null ? `${precipPct}%` : '—'}</td>`,
      precipIn: `<td class="col-precipIn" data-col="precipIn">${precipSum != null ? `${Number(precipSum).toFixed(2)}` : '—'}</td>`,
      snow: `<td class="col-snow" data-col="snow">${snow != null ? Number(snow).toFixed(2) : '—'}</td>`,
      precipHours: `<td class="col-precipHours" data-col="precipHours">${precipHours != null ? String(precipHours) : '—'}</td>`,
      wind: `<td class="wind-td col-wind" data-col="wind">${windCellHtml(windDir, windMax, { size: 24 })}</td>`,
      gust: `<td class="col-gust" data-col="gust">${gustMax != null ? `${Math.round(gustMax)} mph` : '—'}</td>`,
      tstorm: `<td class="col-tstorm" data-col="tstorm">${tstormMax != null ? `${Math.round(Number(tstormMax))}%` : '—'}</td>`,
      cape: `<td class="col-cape" data-col="cape">${capeMax != null ? `${Math.round(Number(capeMax))}` : '—'}</td>`,
      rh: `<td class="col-rh" data-col="rh">${rhLabel}</td>`,
      dew: `<td class="col-dew" data-col="dew">${dewLabel}</td>`,
      cloud: `<td class="col-cloud" data-col="cloud">${cloudMean != null ? `${Math.round(Number(cloudMean))}%` : '—'}</td>`,
      uv: `<td class="col-uv" data-col="uv">${uvMax != null ? String(uvMax) : '—'}</td>`,
      vis: `<td class="col-vis" data-col="vis">${fmtVisibility(visMin)}</td>`,
      sunshine: `<td class="col-sunshine" data-col="sunshine">${fmtDurationSeconds(sunshine) ?? '—'}</td>`,
      daylight: `<td class="col-daylight" data-col="daylight">${fmtDurationSeconds(daylight) ?? '—'}</td>`,
      et0: `<td class="col-et0" data-col="et0">${et0 != null ? Number(et0).toFixed(2) : '—'}</td>`,
      sunrise: `<td class="col-sunrise" data-col="sunrise">${fmtClock(rise)}</td>`,
      sunset: `<td class="col-sunset" data-col="sunset">${fmtClock(set)}</td>`,
    };
    tr.innerHTML = cols.map((c) => cellByKey[c.key]).join('');
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  attachColumnToggles(wrap, cols);
  return wrap;
}

/**
 * Collapsed comparison detail under the 10-day forecast.
 * @param {Record<string, unknown> | null} daily
 * @param {Record<string, unknown> | null} climatology
 * @returns {HTMLElement}
 */
function buildClimatologyCompareSection(daily, climatology) {
  const wrap = document.createElement('div');
  wrap.className = 'climatology-compare';
  if (!climatology?.doy) {
    renderEmpty(
      wrap,
      'Climatology unavailable',
      'Typical conditions for this date have not been loaded yet (ERA5 normals refresh about monthly).',
    );
    return wrap;
  }

  const period = climatologyPeriodLabel(climatology);
  const lead = document.createElement('p');
  lead.className = 'climatology-compare__lead';
  lead.textContent = `Forecast highs and lows compared with typical values for each calendar date from ERA5 reanalysis (${period}). This is not an official NOAA/NCEI climate normal.`;
  wrap.appendChild(lead);

  const times = /** @type {string[]} */ (daily?.time ?? []);
  if (!times.length) {
    renderEmpty(wrap, 'No daily forecast', 'Cannot compare without a 10-day forecast.');
    return wrap;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table data-table--dense';
  table.innerHTML = `
    <caption class="sr-only">Forecast compared to typical conditions</caption>
    <thead>
      <tr>
        <th scope="col">Day</th>
        <th scope="col">Forecast high / low</th>
        <th scope="col">Typical high / low</th>
        <th scope="col">Δ high / low</th>
        <th scope="col">Precip vs typical</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  for (let i = 0; i < Math.min(10, times.length); i += 1) {
    const iso = String(times[i]).slice(0, 10);
    const hi = /** @type {(number | null)[]} */ (daily?.temperature_2m_max ?? [])[i];
    const lo = /** @type {(number | null)[]} */ (daily?.temperature_2m_min ?? [])[i];
    const precip = /** @type {(number | null)[]} */ (daily?.precipitation_sum ?? [])[i];
    const cmp = compareDailyToNormal(climatology, iso, hi, lo, precip);
    const fc =
      hi != null && lo != null ? `${Math.round(Number(hi))}° / ${Math.round(Number(lo))}°` : '—';
    const typ =
      cmp.normal?.tmax != null && cmp.normal?.tmin != null
        ? `${Math.round(cmp.normal.tmax)}° / ${Math.round(cmp.normal.tmin)}°`
        : '—';
    const dHi = formatTempDelta(cmp.deltaHi);
    const dLo = formatTempDelta(cmp.deltaLo);
    const delta = dHi && dLo ? `${dHi} / ${dLo}` : dHi || dLo || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(times[i])}</td>
      <td>${escapeHtml(fc)}</td>
      <td>${escapeHtml(typ)}</td>
      <td><span class="vs-typical-cell">${escapeHtml(delta)}</span></td>
      <td>${escapeHtml(cmp.precipLabel ?? '—')}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
  return wrap;
}

/**
 * Hourly/daily tables + collapsible detail sections (no summary header or map).
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   sources?: unknown[],
 *   includeMapSlot?: boolean,
 *   spaceWeather?: Record<string, unknown> | null,
 *   hourlyCollapsed?: boolean,
 *   dailyCollapsed?: boolean,
 * }} [options]
 */
export function renderDeepForecast(root, data, options = {}) {
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const sunrises = /** @type {string[]} */ (daily?.sunrise ?? []);
  const sunsets = /** @type {string[]} */ (daily?.sunset ?? []);
  const elevationFt =
    data.elevation_ft != null && !Number.isNaN(Number(data.elevation_ft))
      ? Number(data.elevation_ft)
      : null;
  const links = /** @type {Record<string, string | null>} */ (data.links ?? {});
  const metaSources = Array.isArray(options.sources) ? options.sources : [];
  appendDeepForecast(root, data, {
    sources: metaSources,
    sunrises,
    sunsets,
    elevationFt,
    links,
    includeMapSlot: options.includeMapSlot === true,
    spaceWeather: options.spaceWeather ?? null,
    hourlyCollapsed: options.hourlyCollapsed === true,
    dailyCollapsed: options.dailyCollapsed === true,
  });
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   sources: unknown[],
 *   sunrises: string[],
 *   sunsets: string[],
 *   elevationFt: number | null,
 *   links: Record<string, string | null>,
 *   includeMapSlot?: boolean,
 *   spaceWeather?: Record<string, unknown> | null,
 *   hourlyCollapsed?: boolean,
 *   dailyCollapsed?: boolean,
 * }} ctx
 */
function appendDeepForecast(root, data, ctx) {
  const {
    sunrises,
    sunsets,
    elevationFt,
    links,
    sources: metaSources,
    spaceWeather = null,
    hourlyCollapsed = false,
    dailyCollapsed = false,
  } = ctx;
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const climatology = /** @type {Record<string, unknown> | null} */ (data.climatology ?? null);

  if (!hourly?.time || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    const empty = document.createElement('div');
    renderEmpty(
      empty,
      'No hourly data',
      data.forecastStale
        ? 'Prior forecast also lacked hourly rows.'
        : 'Forecast temporarily unavailable (source rate-limited or failed this run).',
    );
    if (hourlyCollapsed) {
      renderCollapsibleSection(root, 'hourly-heading', 'Hourly forecast (48h)', () => empty, {
        open: false,
      });
    } else {
      renderForecastCard(root, 'hourly-heading', 'Hourly forecast (48h)', empty);
    }
  } else if (hourlyCollapsed) {
    renderCollapsibleSection(
      root,
      'hourly-heading',
      'Hourly forecast (48h)',
      () => buildHourlyTable(hourly, sunrises, sunsets, { elevationFt }),
      { open: false },
    );
  } else {
    renderForecastCard(
      root,
      'hourly-heading',
      'Hourly forecast (48h)',
      buildHourlyTable(hourly, sunrises, sunsets, { elevationFt }),
    );
  }

  const dailyTimes = /** @type {string[]} */ (daily?.time ?? []);
  if (!dailyTimes.length) {
    const empty = document.createElement('div');
    renderEmpty(
      empty,
      'No daily forecast',
      'Forecast temporarily unavailable (source rate-limited or failed this run).',
    );
    if (dailyCollapsed) {
      renderCollapsibleSection(root, 'daily-heading', 'Daily forecast (10 day)', () => empty, {
        open: false,
      });
    } else {
      renderForecastCard(root, 'daily-heading', 'Daily forecast (10 day)', empty);
    }
  } else if (dailyCollapsed) {
    renderCollapsibleSection(
      root,
      'daily-heading',
      'Daily forecast (10 day)',
      () => buildDailyTable(/** @type {Record<string, unknown>} */ (daily), climatology),
      { open: false },
    );
  } else {
    renderForecastCard(
      root,
      'daily-heading',
      'Daily forecast (10 day)',
      buildDailyTable(/** @type {Record<string, unknown>} */ (daily), climatology),
    );
  }

  renderCollapsibleSection(
    root,
    'climatology-heading',
    'Compared to typical',
    () => buildClimatologyCompareSection(daily, climatology),
    { open: false },
  );

  if (ctx.includeMapSlot) {
    const mapSlot = document.createElement('div');
    mapSlot.id = 'map-slot';
    mapSlot.className = 'map-slot';
    mapSlot.innerHTML = `
    <section class="map-section" aria-labelledby="map-heading">
      <h2 id="map-heading">Local map &amp; radar</h2>
      <p class="map-lead">Regional view with RainViewer radar (pan and zoom within supported tile levels). Alert polygons load when available.</p>
      <div class="map-controls">
        <label class="checkbox-label">
          <input type="checkbox" id="radar-toggle" />
          RainViewer radar
        </label>
        <label for="radar-opacity" class="opacity-label">
          Opacity
          <input type="range" id="radar-opacity" min="10" max="90" value="55" />
        </label>
      </div>
      <div id="map-container" class="map-container"></div>
    </section>
  `;
    root.appendChild(mapSlot);
  }

  const sections = document.createElement('div');
  sections.className = 'dashboard-sections';

  renderCollapsibleSection(
    sections,
    'alerts-heading',
    'Alerts & discussion',
    () => {
      const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
      const afd = /** @type {Record<string, unknown> | null} */ (data.afd ?? null);
      const wrap = document.createDocumentFragment();
      if (!alerts.length) {
        renderEmpty(wrap, 'No active alerts', 'for this county.');
      } else {
        const ul = document.createElement('ul');
        ul.className = 'alert-list alert-list--detailed';
        alerts.forEach((a) => {
          const li = document.createElement('li');
          const sev = a.severity ? String(a.severity) : 'Unknown';
          const headline = String(a.headline ?? a.event ?? 'Alert');
          const desc = a.description ? String(a.description) : '';
          const long = desc.length > 220;

          if (long) {
            const details = document.createElement('details');
            details.className = 'alert-item';
            const summary = document.createElement('summary');
            summary.innerHTML = `
              <strong>${escapeHtml(String(a.event ?? 'Alert'))}</strong>
              <span class="alert-severity alert-severity--${escapeHtml(sev.toLowerCase())}">${escapeHtml(sev)}</span>
              ${a.ends ? `<span class="alert-ends">Until ${escapeHtml(fmtDateTime(String(a.ends)))}</span>` : ''}
              <span class="alert-headline">${escapeHtml(headline)}</span>
            `;
            details.appendChild(summary);
            const body = document.createElement('div');
            body.className = 'alert-body';
            const parts = [];
            if (a.areaDesc) {
              parts.push(`<p><strong>Area:</strong> ${escapeHtml(String(a.areaDesc))}</p>`);
            }
            parts.push(`<pre class="alert-description">${escapeHtml(desc)}</pre>`);
            if (a.url) {
              parts.push(
                `<p>${sourceLink(String(a.url), 'Full NWS alert', 'btn btn-secondary btn-sm')}</p>`,
              );
            }
            body.innerHTML = parts.join('');
            details.appendChild(body);
            li.appendChild(details);
          } else {
            li.className = 'alert-item alert-item--compact';
            li.innerHTML = `
              <strong>${escapeHtml(String(a.event ?? 'Alert'))}</strong>
              <span class="alert-severity alert-severity--${escapeHtml(sev.toLowerCase())}">${escapeHtml(sev)}</span>
              ${a.ends ? `<span class="alert-ends">Until ${escapeHtml(fmtDateTime(String(a.ends)))}</span>` : ''}
              <p class="alert-headline">${escapeHtml(headline)}</p>
              ${desc ? `<p>${escapeHtml(desc)}</p>` : ''}
              ${a.areaDesc ? `<p><strong>Area:</strong> ${escapeHtml(String(a.areaDesc))}</p>` : ''}
              ${a.url ? `<p>${sourceLink(String(a.url), 'Full NWS alert', 'btn btn-secondary btn-sm')}</p>` : ''}
            `;
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      if (afd?.snippet || afd?.url) {
        const box = document.createElement('div');
        box.className = 'afd-box';
        const issued = afd.issued ? ` · issued ${fmtDateTime(String(afd.issued))}` : '';
        box.innerHTML = `
          <p class="afd-snippet"><strong>NWS ${escapeHtml(String(afd.office ?? ''))} discussion${escapeHtml(issued)}:</strong>
            ${afd.snippet ? escapeHtml(String(afd.snippet)) : ''}</p>
          ${afd.url ? sourceLink(String(afd.url), 'Full Area Forecast Discussion', 'btn btn-secondary btn-sm') : ''}
        `;
        wrap.appendChild(box);
      }
      const hwo = /** @type {Record<string, unknown> | null} */ (data.hwo ?? null);
      if (hwo?.snippet || hwo?.url) {
        const box = document.createElement('div');
        box.className = 'afd-box';
        const issued = hwo.issued ? ` · issued ${fmtDateTime(String(hwo.issued))}` : '';
        box.innerHTML = `
          <p class="afd-snippet"><strong>NWS ${escapeHtml(String(hwo.office ?? ''))} hazardous weather outlook${escapeHtml(issued)}:</strong>
            ${hwo.snippet ? escapeHtml(String(hwo.snippet)) : ''}</p>
          ${hwo.url ? sourceLink(String(hwo.url), 'Full Hazardous Weather Outlook', 'btn btn-secondary btn-sm') : ''}
        `;
        wrap.appendChild(box);
      }
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'roads-heading',
    'Roads & passes (CDOT)',
    () => {
      const roads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
      const roadAlerts = /** @type {Record<string, unknown>[]} */ (roads?.alerts ?? []);
      const cams = /** @type {Record<string, unknown>[]} */ (
        roads?.cameras ?? (data.cdot_camera ? [data.cdot_camera] : [])
      );
      const rwis = /** @type {Record<string, unknown> | null} */ (
        roads?.rwis ?? data.cdot_rwis ?? null
      );
      const wrap = document.createDocumentFragment();
      if (!roadAlerts.length && !cams.length && !rwis) {
        renderEmpty(wrap, 'No CDOT road data', 'for this location right now.');
        return wrap;
      }
      if (roadAlerts.length) {
        const ul = document.createElement('ul');
        ul.className = 'alert-list';
        roadAlerts.forEach((a) => {
          const li = document.createElement('li');
          const flags = [
            a.chain_law ? 'Chain law' : null,
            a.closure ? 'Closure' : null,
            a.pass_relevant ? 'Pass corridor' : null,
          ]
            .filter(Boolean)
            .join(' · ');
          li.innerHTML = `
            <strong>${escapeHtml(String(a.title ?? 'Travel alert'))}</strong>
            ${a.distance_km != null ? `<span class="alert-ends">${escapeHtml(String(a.distance_km))} km</span>` : ''}
            ${flags ? `<p>${escapeHtml(flags)}</p>` : ''}
            ${a.roads ? `<p>Road: ${escapeHtml(String(a.roads))}</p>` : ''}
            ${a.description ? `<p>${escapeHtml(String(a.description))}</p>` : ''}
            ${a.observed ? `<p class="table-hint">Updated ${escapeHtml(fmtDateTime(String(a.observed)))}</p>` : ''}
          `;
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      if (rwis) {
        const dl = document.createElement('dl');
        dl.className = 'metric-list';
        dl.innerHTML = `
          <dt>RWIS</dt><dd>${escapeHtml(String(rwis.name ?? ''))}${rwis.distance_km != null ? ` (${rwis.distance_km} km)` : ''}</dd>
          ${rwis.air_temp_f != null ? `<dt>Air</dt><dd>${Math.round(Number(rwis.air_temp_f))}°F</dd>` : ''}
          ${rwis.surface_temp_f != null ? `<dt>Pavement</dt><dd>${Math.round(Number(rwis.surface_temp_f))}°F</dd>` : ''}
          ${rwis.surface_status ? `<dt>Surface</dt><dd>${escapeHtml(String(rwis.surface_status))}</dd>` : ''}
        `;
        wrap.appendChild(dl);
      }
      if (cams.length) {
        const p = document.createElement('p');
        p.className = 'table-hint';
        p.textContent = `${cams.length} nearby CDOT camera${cams.length === 1 ? '' : 's'} shown in the intel column.`;
        wrap.appendChild(p);
      }
      const linkP = document.createElement('p');
      linkP.innerHTML = sourceLink(
        'https://maps.cotrip.org/',
        'Open COtrip map',
        'btn btn-secondary btn-sm',
      );
      wrap.appendChild(linkP);
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'coagmet-heading',
    'Agriculture (CoAgMET)',
    () => {
      const coag = /** @type {Record<string, unknown> | null} */ (data.coagmet ?? null);
      if (!coag) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'No nearby CoAgMET station',
          'No agricultural station within ~40 km of this location.',
        );
        return frag;
      }
      const soil5 = coagValue(coag.soil_temp_5cm_f);
      const soil15 = coagValue(coag.soil_temp_15cm_f);
      const rows = [
        ['Station', `${coag.station_name ?? coag.station_id} (${coag.distance_km} km)`],
        ['Soil 5 cm', soil5 != null ? `${soil5}°F` : null],
        ['Soil 15 cm', soil15 != null ? `${soil15}°F` : null],
        [
          'Soil moisture 5 cm',
          coagValue(coag.soil_moisture_5cm) != null ? String(coag.soil_moisture_5cm) : null,
        ],
        [
          'Soil moisture 15 cm',
          coagValue(coag.soil_moisture_15cm) != null ? String(coag.soil_moisture_15cm) : null,
        ],
        ['Precip', coagValue(coag.precip_in) != null ? `${coag.precip_in} in` : null],
        ['ET₀', coagValue(coag.eto_in) != null ? String(coag.eto_in) : null],
        [
          'Vapor pressure',
          coagValue(coag.vapor_pressure) != null ? String(coag.vapor_pressure) : null,
        ],
        ['Solar', coagValue(coag.solar_radiation) != null ? String(coag.solar_radiation) : null],
        ['Air temp', coag.air_temp_f != null ? `${coag.air_temp_f}°F` : null],
        ['Humidity', coag.relative_humidity != null ? `${coag.relative_humidity}%` : null],
        ['Wind', coag.wind_speed_mph != null ? `${coag.wind_speed_mph} mph` : null],
      ].filter(([, v]) => v != null && v !== '');

      const wrap = document.createDocumentFragment();
      const dl = document.createElement('dl');
      dl.className = 'metric-list';
      dl.innerHTML = rows
        .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
        .join('');
      wrap.appendChild(dl);
      const url = coag.url || links.coagmet;
      if (url) {
        const p = document.createElement('p');
        p.className = 'section-cta';
        p.innerHTML = sourceLink(String(url), 'Open CoAgMET station', 'btn btn-secondary btn-sm');
        wrap.appendChild(p);
      }
      return wrap;
    },
    {
      open: false,
    },
  );

  renderCollapsibleSection(
    sections,
    'metar-heading',
    'Aviation (METAR / TAF)',
    () => {
      const av = /** @type {Record<string, unknown> | null} */ (data.aviation ?? null);
      if (!av?.raw_metar) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'No nearby METAR',
          'No aviation observation within range for this location.',
        );
        return frag;
      }
      const wrap = document.createDocumentFragment();
      const dl = document.createElement('dl');
      dl.className = 'metric-list';
      const windBits = [];
      if (av.wind_dir != null) windBits.push(`${av.wind_dir}°`);
      if (av.wind_kt != null) windBits.push(`${av.wind_kt} kt`);
      if (av.gust_kt != null) windBits.push(`G${av.gust_kt}`);
      const rows = [
        ['Airport', `${av.icao ?? '—'}${av.distance_km != null ? ` (${av.distance_km} km)` : ''}`],
        ['Flight category', av.flight_category != null ? String(av.flight_category) : null],
        ['Temperature', av.temp_f != null ? `${av.temp_f}°F` : null],
        ['Wind', windBits.length ? windBits.join(' ') : null],
        ['Visibility', av.visibility != null ? String(av.visibility) : null],
        ['Cover', av.cover != null ? String(av.cover) : null],
        ['Altimeter', av.altimeter != null ? String(av.altimeter) : null],
        [
          'Observed',
          av.observed != null
            ? fmtDateTime(
                typeof av.observed === 'number'
                  ? new Date(Number(av.observed) * 1000).toISOString()
                  : String(av.observed),
              )
            : null,
        ],
      ].filter(([, v]) => v != null && v !== '');
      dl.innerHTML = rows
        .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
        .join('');
      wrap.appendChild(dl);

      const metarLabel = document.createElement('h3');
      metarLabel.className = 'subhead';
      metarLabel.textContent = 'Raw METAR';
      wrap.appendChild(metarLabel);
      const pre = document.createElement('pre');
      pre.className = 'metar-raw';
      pre.textContent = String(av.raw_metar);
      wrap.appendChild(pre);
      if (av.raw_taf) {
        const tafLabel = document.createElement('h3');
        tafLabel.className = 'subhead';
        tafLabel.textContent = 'Raw TAF';
        wrap.appendChild(tafLabel);
        const taf = document.createElement('pre');
        taf.className = 'metar-raw';
        taf.textContent = String(av.raw_taf);
        wrap.appendChild(taf);
      }
      const url = av.url || links.aviation;
      if (url) {
        const p = document.createElement('p');
        p.className = 'section-cta';
        p.innerHTML = sourceLink(
          String(url),
          'Aviation Weather Center',
          'btn btn-secondary btn-sm',
        );
        wrap.appendChild(p);
      }
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'aqi-heading',
    'Air quality & pollen',
    () => {
      const an = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
      const pa = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
      const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
      const pollenUrl = safeHttpsUrl(String(links.pollen ?? ''));
      const zip = links.pollen_zip != null ? String(links.pollen_zip) : null;
      const city = links.pollen_city != null ? String(links.pollen_city) : null;
      const nabLinks = /** @type {{ name?: string, url?: string }[]} */ (
        /** @type {unknown} */ (links.nab_links) ?? []
      );
      const hasPollen =
        Boolean(pollenUrl) ||
        (Array.isArray(nabLinks) &&
          nabLinks.some((n) => n?.name && safeHttpsUrl(String(n?.url ?? ''))));

      if (!an && !pa && !omaq && !hasPollen) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'No air quality data',
          'No AirNow, PurpleAir, or model AQ reading nearby.',
        );
        return frag;
      }
      const wrap = document.createDocumentFragment();
      if (an || pa || omaq) {
        const dl = document.createElement('dl');
        dl.className = 'metric-list';
        const parts = [];
        if (an) {
          parts.push(
            `<dt>AirNow AQI</dt><dd>${an.aqi ?? '—'} ${an.category ? `(${escapeHtml(String(an.category))})` : ''}${an.aqi != null ? aqiBarHtml(Number(an.aqi)) : ''}</dd>`,
          );
          parts.push(
            `<dt>Dominant parameter</dt><dd>${an.parameter ? escapeHtml(String(an.parameter)) : '—'}</dd>`,
          );
          if (an.reporting_area) {
            parts.push(`<dt>Reporting area</dt><dd>${escapeHtml(String(an.reporting_area))}</dd>`);
          }
          if (an.distance_km != null) {
            parts.push(`<dt>AirNow distance</dt><dd>${an.distance_km} km</dd>`);
          }
          if (an.observed) {
            parts.push(
              `<dt>AirNow observed</dt><dd>${escapeHtml(fmtDateTime(String(an.observed)))}</dd>`,
            );
          }
          const byParam = /** @type {Record<string, Record<string, unknown>> | null} */ (
            an.by_parameter ?? null
          );
          if (byParam && typeof byParam === 'object') {
            for (const [param, row] of Object.entries(byParam)) {
              if (!row || typeof row !== 'object') continue;
              parts.push(
                `<dt>${escapeHtml(param)}</dt><dd>AQI ${row.aqi ?? '—'}${row.category ? ` (${escapeHtml(String(row.category))})` : ''}</dd>`,
              );
            }
          }
        }
        if (pa) {
          parts.push(
            `<dt>PurpleAir</dt><dd>${pa.name ? escapeHtml(String(pa.name)) : '—'}${pa.distance_km != null ? ` (${pa.distance_km} km)` : ''}</dd>`,
          );
          parts.push(
            `<dt>PurpleAir PM2.5</dt><dd>${pa.pm25 != null ? `${pa.pm25} µg/m³` : '—'}</dd>`,
          );
          parts.push(`<dt>PurpleAir AQI (est.)</dt><dd>${pa.aqi_pm25 ?? '—'}</dd>`);
          if (pa.humidity != null)
            parts.push(`<dt>PurpleAir humidity</dt><dd>${pa.humidity}%</dd>`);
          if (pa.temperature_f != null) {
            parts.push(`<dt>PurpleAir temp</dt><dd>${pa.temperature_f}°F</dd>`);
          }
        }
        if (omaq) {
          parts.push(
            `<dt>Model PM2.5</dt><dd>${omaq.pm25 != null ? `${omaq.pm25} µg/m³` : '—'}</dd>`,
          );
          if (omaq.pm10 != null) {
            parts.push(`<dt>Model PM10</dt><dd>${omaq.pm10} µg/m³</dd>`);
          }
          parts.push(
            `<dt>Model US AQI</dt><dd>${omaq.us_aqi != null ? String(omaq.us_aqi) : '—'}${omaq.us_aqi != null ? aqiBarHtml(Number(omaq.us_aqi)) : ''}</dd>`,
          );
          parts.push(
            `<dt>Model European AQI</dt><dd>${omaq.european_aqi != null ? String(omaq.european_aqi) : '—'}</dd>`,
          );
          if (omaq.o3 != null) parts.push(`<dt>Ozone</dt><dd>${omaq.o3} µg/m³</dd>`);
          if (omaq.no2 != null) parts.push(`<dt>NO₂</dt><dd>${omaq.no2} µg/m³</dd>`);
          if (omaq.so2 != null) parts.push(`<dt>SO₂</dt><dd>${omaq.so2} µg/m³</dd>`);
          if (omaq.co != null) parts.push(`<dt>CO</dt><dd>${omaq.co} µg/m³</dd>`);
          if (omaq.time) {
            parts.push(
              `<dt>Model AQ time</dt><dd>${escapeHtml(fmtDateTime(String(omaq.time)))}</dd>`,
            );
          }
        }
        dl.innerHTML = parts.join('');
        wrap.appendChild(dl);
      }

      const pollenUl = document.createElement('ul');
      pollenUl.className = 'link-list';
      if (pollenUrl) {
        const li = document.createElement('li');
        const label = zip
          ? `Pollen.com forecast (ZIP ${zip}${city ? `, ${city}` : ''})`
          : 'Pollen.com forecast';
        li.innerHTML = `${sourceLink(pollenUrl, label, 'btn btn-secondary btn-sm')} <span class="sr-only">(opens in new tab)</span>`;
        pollenUl.appendChild(li);
      }
      if (Array.isArray(nabLinks)) {
        for (const nab of nabLinks) {
          const u = safeHttpsUrl(String(nab?.url ?? ''));
          if (!u || !nab?.name) continue;
          const li = document.createElement('li');
          li.innerHTML = `${sourceLink(u, String(nab.name), 'btn btn-secondary btn-sm')} <span class="sr-only">(opens in new tab)</span>`;
          pollenUl.appendChild(li);
        }
      }
      if (pollenUl.childNodes.length) {
        const note = document.createElement('p');
        note.className = 'section-note';
        note.textContent =
          'Live US pollen indexes are not available from a free redistributable API — use the offsite links below.';
        wrap.appendChild(note);
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Offsite pollen & allergy';
        wrap.appendChild(h);
        wrap.appendChild(pollenUl);
      }

      const ctas = document.createElement('p');
      ctas.className = 'section-cta';
      ctas.innerHTML = [
        an?.url || links.airnow
          ? sourceLink(String(an?.url || links.airnow), 'AirNow', 'btn btn-secondary btn-sm')
          : '',
        pa?.url || links.purpleair_map
          ? sourceLink(
              String(pa?.url || links.purpleair_map),
              'PurpleAir map',
              'btn btn-secondary btn-sm',
            )
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      if (ctas.innerHTML) wrap.appendChild(ctas);
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'astronomy-heading',
    'Astronomy',
    () => {
      const astro = /** @type {Record<string, unknown> | null} */ (data.astronomy ?? null);
      if (!astro) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'Astronomy unavailable',
          'Sun and moon times were not computed for this location.',
        );
        return frag;
      }
      const wrap = document.createDocumentFragment();
      const moon = /** @type {Record<string, unknown> | null} */ (astro.moon ?? null);
      const civil = /** @type {Record<string, unknown>} */ (astro.civil_twilight ?? {});
      const nautical = /** @type {Record<string, unknown>} */ (astro.nautical_twilight ?? {});
      const astronomical = /** @type {Record<string, unknown>} */ (
        astro.astronomical_twilight ?? {}
      );
      /**
       * @param {number | null | undefined} seconds
       */
      function fmtLen(seconds) {
        if (seconds == null || !Number.isFinite(Number(seconds))) return null;
        const s = Math.max(0, Math.round(Number(seconds)));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h} h ${String(m).padStart(2, '0')} m`;
      }
      const dl = document.createElement('dl');
      dl.className = 'metric-list';
      const dayLen = fmtLen(/** @type {number | null} */ (astro.day_length_s ?? null));
      const visLen = fmtLen(/** @type {number | null} */ (astro.visible_light_s ?? null));
      dl.innerHTML = [
        astro.date
          ? `<dt>Date</dt><dd>${escapeHtml(String(astro.date))} (America/Denver)</dd>`
          : '',
        `<dt>Sunrise</dt><dd>${escapeHtml(fmtClock(astro.sunrise))}</dd>`,
        `<dt>Sunset</dt><dd>${escapeHtml(fmtClock(astro.sunset))}</dd>`,
        dayLen ? `<dt>Length of day</dt><dd>${escapeHtml(dayLen)}</dd>` : '',
        visLen ? `<dt>Visible light</dt><dd>${escapeHtml(visLen)}</dd>` : '',
        `<dt>Civil twilight</dt><dd>${escapeHtml(fmtClock(civil.begin))} – ${escapeHtml(fmtClock(civil.end))}</dd>`,
        `<dt>Nautical twilight</dt><dd>${escapeHtml(fmtClock(nautical.begin))} – ${escapeHtml(fmtClock(nautical.end))}</dd>`,
        `<dt>Astronomical twilight</dt><dd>${escapeHtml(fmtClock(astronomical.begin))} – ${escapeHtml(fmtClock(astronomical.end))}</dd>`,
        moon
          ? `<dt>Moon phase</dt><dd>${escapeHtml(String(moon.phase_label ?? '—'))}${
              moon.illumination_pct != null
                ? ` · ${Math.round(Number(moon.illumination_pct))}% illuminated`
                : ''
            }</dd>
             <dt>Moonrise</dt><dd>${escapeHtml(fmtClock(moon.rise))}</dd>
             <dt>Moonset</dt><dd>${escapeHtml(fmtClock(moon.set))}</dd>`
          : '',
      ]
        .filter(Boolean)
        .join('');
      wrap.appendChild(dl);

      const phases = /** @type {{ name?: string, date?: string }[]} */ (astro.next_phases ?? []);
      if (phases.length) {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Upcoming moon phases';
        wrap.appendChild(h);
        const ul = document.createElement('ul');
        ul.className = 'plain-list';
        for (const p of phases) {
          if (!p?.name || !p?.date) continue;
          const li = document.createElement('li');
          li.textContent = `${p.name} — ${p.date}`;
          ul.appendChild(li);
        }
        wrap.appendChild(ul);
      }
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'smoke-heading',
    'Fire weather & restrictions',
    () => {
      const wrap = document.createDocumentFragment();
      const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
      const fireAlerts = alerts.filter((a) =>
        /red\s*flag|fire\s*weather/i.test(String(a.event ?? a.headline ?? '')),
      );
      const fw = /** @type {Record<string, unknown> | null} */ (data.fire_weather ?? null);
      const hms = /** @type {Record<string, unknown> | null} */ (data.hms_smoke ?? null);
      const nearby = /** @type {Record<string, unknown> | null} */ (data.nearby_fires ?? null);
      const restrictions = /** @type {Record<string, unknown> | null} */ (
        data.fire_restrictions ?? null
      );

      if (fireAlerts.length) {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Active fire weather alerts';
        wrap.appendChild(h);
        const ul = document.createElement('ul');
        ul.className = 'alert-list';
        for (const a of fireAlerts) {
          const li = document.createElement('li');
          const event = String(a.event ?? 'Alert');
          const headline = a.headline ? String(a.headline) : '';
          li.innerHTML = `<strong>${escapeHtml(event)}</strong>${
            headline && headline !== event ? ` — ${escapeHtml(headline)}` : ''
          }${
            a.url && safeHttpsUrl(String(a.url))
              ? ` ${sourceLink(String(a.url), 'NWS detail', 'btn btn-link btn-sm')}`
              : ''
          }`;
          ul.appendChild(li);
        }
        wrap.appendChild(ul);
      }

      {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'SPC fire weather outlook';
        wrap.appendChild(h);
        if (!fw || !fw.day1) {
          renderEmpty(
            wrap,
            'No SPC outlook for this point today',
            'Day 1–2 fire weather polygons unavailable for this run.',
          );
        } else {
          const day1 = /** @type {Record<string, unknown>} */ (fw.day1);
          const day2 = /** @type {Record<string, unknown>} */ (fw.day2 ?? {});
          const dl = document.createElement('dl');
          dl.className = 'metric-list';
          dl.innerHTML = `
            <dt>Day 1 Wind/RH</dt><dd><span class="fire-risk fire-risk--${escapeHtml(String(day1.windRh ?? 'none'))}">${escapeHtml(String(day1.windRh ?? 'none'))}</span></dd>
            <dt>Day 1 Dry thunderstorms</dt><dd>${escapeHtml(String(day1.dryT ?? 'none'))}</dd>
            <dt>Day 2 Wind/RH</dt><dd><span class="fire-risk fire-risk--${escapeHtml(String(day2.windRh ?? 'none'))}">${escapeHtml(String(day2.windRh ?? 'none'))}</span></dd>
            <dt>Day 2 Dry thunderstorms</dt><dd>${escapeHtml(String(day2.dryT ?? 'none'))}</dd>
            ${day1.valid ? `<dt>Day 1 valid</dt><dd>${escapeHtml(String(day1.valid))}</dd>` : ''}
          `;
          wrap.appendChild(dl);
          const note = document.createElement('p');
          note.className = 'table-hint';
          note.textContent =
            'Storm Prediction Center categorical outlook at this location (Elevated / Critical / Extreme). Not a burn ban.';
          wrap.appendChild(note);
          if (fw.sourceUrl) {
            const p = document.createElement('p');
            p.innerHTML = sourceLink(String(fw.sourceUrl), 'SPC fire weather overview');
            wrap.appendChild(p);
          }
        }
      }

      {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'HMS satellite smoke';
        wrap.appendChild(h);
        if (!hms || !hms.density) {
          renderEmpty(
            wrap,
            'No HMS smoke data',
            'Satellite smoke analysis unavailable for this run.',
          );
        } else {
          const dl = document.createElement('dl');
          dl.className = 'metric-list';
          dl.innerHTML = `
            <dt>Smoke density</dt><dd>${escapeHtml(String(hms.density))}</dd>
            ${hms.observed ? `<dt>Analysis date</dt><dd>${escapeHtml(String(hms.observed))}</dd>` : ''}
          `;
          wrap.appendChild(dl);
          const note = document.createElement('p');
          note.className = 'table-hint';
          note.textContent =
            'NOAA Hazard Mapping System smoke polygons. Density is estimated at this location.';
          wrap.appendChild(note);
          if (hms.sourceUrl) {
            const p = document.createElement('p');
            p.innerHTML = sourceLink(String(hms.sourceUrl), 'HMS source archive');
            wrap.appendChild(p);
          }
        }
      }

      {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Nearby wildfires';
        wrap.appendChild(h);
        const incidents = /** @type {Record<string, unknown>[]} */ (nearby?.incidents ?? []);
        if (!nearby || !incidents.length) {
          renderEmpty(
            wrap,
            'No active incidents within 80 km',
            'NIFC WFIGS current locations near this catalog point.',
          );
        } else {
          const ul = document.createElement('ul');
          ul.className = 'alert-list';
          for (const inc of incidents) {
            const li = document.createElement('li');
            const bits = [escapeHtml(String(inc.name ?? 'Incident'))];
            if (inc.distance_km != null) bits.push(`${Number(inc.distance_km).toFixed(1)} km`);
            if (inc.acres != null) bits.push(`${Math.round(Number(inc.acres))} acres`);
            if (inc.percentContained != null) {
              bits.push(`${Math.round(Number(inc.percentContained))}% contained`);
            }
            li.innerHTML = bits.join(' · ');
            if (inc.url && safeHttpsUrl(String(inc.url))) {
              li.innerHTML += ` ${sourceLink(String(inc.url), 'InciWeb search', 'btn btn-link btn-sm')}`;
            }
            ul.appendChild(li);
          }
          wrap.appendChild(ul);
          if (nearby.sourceUrl) {
            const p = document.createElement('p');
            p.innerHTML = sourceLink(String(nearby.sourceUrl), 'NIFC open data');
            wrap.appendChild(p);
          }
        }
      }

      {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Burn / fire restrictions';
        wrap.appendChild(h);
        if (!restrictions) {
          renderEmpty(
            wrap,
            'Restriction status unavailable — check links below',
            'County restriction feed did not return data for this run.',
          );
        } else {
          const status = String(restrictions.status ?? 'unknown');
          const statusLabel =
            status === 'restriction_reported'
              ? 'Restriction reported (county feed)'
              : status === 'none_reported'
                ? 'No restriction reported (county feed)'
                : 'Status unavailable';
          const dl = document.createElement('dl');
          dl.className = 'metric-list';
          dl.innerHTML = `
            <dt>County</dt><dd>${escapeHtml(String(restrictions.county ?? data.county ?? ''))}</dd>
            <dt>Status</dt><dd>${escapeHtml(statusLabel)}</dd>
          `;
          wrap.appendChild(dl);
          if (restrictions.redFlagNote) {
            const rf = document.createElement('p');
            rf.className = 'table-hint';
            rf.textContent =
              'Many Colorado counties automatically tighten burn rules during Red Flag Warnings.';
            wrap.appendChild(rf);
          }
          const disc = document.createElement('p');
          disc.className = 'table-hint';
          disc.textContent = String(
            restrictions.disclaimer ??
              'Verify with local sheriff / land manager before burning or campfires.',
          );
          wrap.appendChild(disc);

          const linkBits = [];
          if (restrictions.countyUrl) {
            linkBits.push(
              externalVerifyLink(
                String(restrictions.countyUrl),
                `${String(restrictions.county ?? 'County')} official page`,
              ),
            );
          }
          const statewide = /** @type {{ name?: string, url?: string }[]} */ (
            restrictions.statewideUrls ?? []
          );
          for (const s of statewide) {
            if (s?.url && s?.name) linkBits.push(externalVerifyLink(String(s.url), String(s.name)));
          }
          if (linkBits.filter(Boolean).length) {
            const p = document.createElement('p');
            p.className = 'source-links';
            p.innerHTML = linkBits.filter(Boolean).join(' ');
            wrap.appendChild(p);
          }
        }
      }

      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'hydrology-heading',
    'Hydrology (USGS)',
    () => {
      const usgs = /** @type {Record<string, unknown> | null} */ (data.usgs ?? null);
      if (!usgs) {
        const frag = document.createDocumentFragment();
        renderEmpty(frag, 'No nearby USGS gauge', 'within 30 km of this location.');
        return frag;
      }
      const wrap = document.createDocumentFragment();
      const dl = document.createElement('dl');
      dl.className = 'metric-list';
      const rows = [
        [
          'Station',
          `${usgs.station_name ?? usgs.station_id}${usgs.distance_km != null ? ` (${usgs.distance_km} km)` : ''}`,
        ],
        [
          'Discharge',
          usgs.discharge_cfs != null ? `${Math.round(Number(usgs.discharge_cfs))} cfs` : null,
        ],
        [
          'Gauge height',
          usgs.gauge_height_ft != null ? `${Number(usgs.gauge_height_ft).toFixed(2)} ft` : null,
        ],
        [
          'Water temperature',
          usgs.water_temp_f != null ? `${Math.round(Number(usgs.water_temp_f))}°F` : null,
        ],
        ['Observed', usgs.observed ? fmtDateTime(String(usgs.observed)) : null],
      ].filter(([, v]) => v != null && v !== '');
      dl.innerHTML = rows
        .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
        .join('');
      wrap.appendChild(dl);
      const p = document.createElement('p');
      p.className = 'section-cta';
      const linkBits = [];
      if (usgs.url) {
        linkBits.push(sourceLink(String(usgs.url), 'USGS gauge page', 'btn btn-secondary btn-sm'));
      }
      linkBits.push(
        sourceLink('https://waterwatch.usgs.gov/', 'USGS WaterWatch', 'btn btn-secondary btn-sm'),
      );
      p.innerHTML = linkBits.join(' ');
      wrap.appendChild(p);
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'snowpack-heading',
    'Snowpack (SNOTEL)',
    () => {
      const sn = /** @type {Record<string, unknown> | null} */ (data.snotel ?? null);
      if (!sn) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'No nearby SNOTEL station',
          'Shown for sites above 7,000 ft when a station is within 50 km.',
        );
        return frag;
      }
      const wrap = document.createDocumentFragment();
      const dl = document.createElement('dl');
      dl.className = 'metric-list';
      const rows = [
        [
          'Station',
          `${sn.station_name ?? sn.station_id}${sn.distance_km != null ? ` (${sn.distance_km} km)` : ''}${sn.elevation_ft != null ? ` · ${Number(sn.elevation_ft).toLocaleString()} ft` : ''}`,
        ],
        ['Snow depth', sn.snow_depth_in != null ? `${sn.snow_depth_in} in` : null],
        ['Snow water equivalent', sn.swe_in != null ? `${sn.swe_in} in` : null],
        ['Air temp', sn.air_temp_f != null ? `${sn.air_temp_f}°F` : null],
        [
          '24h precipitation',
          sn.precipitation_24h_in != null ? `${sn.precipitation_24h_in} in` : null,
        ],
        ['Observed', sn.observed ? String(sn.observed) : null],
      ].filter(([, v]) => v != null && v !== '');
      dl.innerHTML = rows
        .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
        .join('');
      wrap.appendChild(dl);
      const p = document.createElement('p');
      p.className = 'section-cta';
      const linkBits = [];
      if (sn.url) {
        linkBits.push(sourceLink(String(sn.url), 'SNOTEL site page', 'btn btn-secondary btn-sm'));
      }
      linkBits.push(
        sourceLink(
          'https://www.nrcs.usda.gov/wps/portal/wcc/home/quicklinks/states/colorado/',
          'NRCS Colorado snow report',
          'btn btn-secondary btn-sm',
        ),
      );
      p.innerHTML = linkBits.join(' ');
      wrap.appendChild(p);
      return wrap;
    },
    { open: false },
  );

  renderCollapsibleSection(
    sections,
    'ham-heading',
    'Ham radio & space weather',
    () => {
      const sw = spaceWeather;
      const rf = /** @type {Record<string, unknown> | null} */ (data.rf_comms ?? null);
      const pws = /** @type {Record<string, unknown> | null} */ (data.pws ?? null);
      const pwsLinks = /** @type {Record<string, unknown>} */ (pws?.links ?? {});
      const wrap = document.createDocumentFragment();

      if (!sw && !rf) {
        renderEmpty(
          wrap,
          'Space weather unavailable',
          'SWPC snapshot did not load for this run. VHF ducting appears when the forecast model includes an 850 mb profile.',
        );
        return wrap;
      }

      const lead = document.createElement('p');
      lead.className = 'table-hint';
      lead.textContent =
        'Planetary space weather from NOAA SWPC plus model-derived VHF/UHF ducting. HF band ratings are a simple SFI/Kp heuristic — not a live MUF product.';
      wrap.appendChild(lead);

      if (sw?.carriedForward) {
        const stale = document.createElement('p');
        stale.className = 'stale-banner';
        stale.setAttribute('role', 'status');
        stale.textContent =
          'Showing last successful space-weather snapshot — SWPC pull failed this run.';
        wrap.appendChild(stale);
      }

      const scales = /** @type {Record<string, unknown> | null} */ (sw?.scales ?? null);
      if (scales) {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'NOAA scales (R / S / G)';
        wrap.appendChild(h);
        const chips = document.createElement('div');
        chips.className = 'sw-scales';
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'NOAA space weather scales');
        for (const letter of ['R', 'S', 'G']) {
          const block = /** @type {Record<string, unknown> | null} */ (
            scales[letter] && typeof scales[letter] === 'object' ? scales[letter] : null
          );
          const scale =
            block?.scale != null && Number.isFinite(Number(block.scale))
              ? Number(block.scale)
              : null;
          const text = block?.text != null ? String(block.text) : '';
          const sev =
            scale == null
              ? 'unknown'
              : scale >= 4
                ? 'extreme'
                : scale >= 3
                  ? 'strong'
                  : scale >= 1
                    ? 'minor'
                    : 'none';
          const span = document.createElement('span');
          span.className = `sw-scale sw-scale--${sev}`;
          span.innerHTML = `<span class="sw-scale__code">${escapeHtml(letter)}${scale != null ? scale : ''}</span><span class="sw-scale__text">${escapeHtml(text || (scale === 0 ? 'none' : 'n/a'))}</span>`;
          chips.appendChild(span);
        }
        wrap.appendChild(chips);

        const forecast = /** @type {Record<string, unknown>[]} */ (scales.forecast ?? []);
        if (forecast.length) {
          const ul = document.createElement('ul');
          ul.className = 'alert-list';
          for (const day of forecast) {
            const li = document.createElement('li');
            const g = /** @type {Record<string, unknown>} */ (day.G ?? {});
            const r = /** @type {Record<string, unknown>} */ (day.R ?? {});
            const s = /** @type {Record<string, unknown>} */ (day.S ?? {});
            const bits = [
              day.date ? String(day.date) : 'Forecast day',
              g.scale != null ? `G${g.scale}` : null,
              r.scale != null ? `R${r.scale}` : null,
              s.scale != null ? `S${s.scale}` : null,
            ].filter(Boolean);
            li.textContent = bits.join(' · ');
            ul.appendChild(li);
          }
          wrap.appendChild(ul);
        }
      }

      {
        const dl = document.createElement('dl');
        dl.className = 'metric-list';
        const kp = /** @type {Record<string, unknown> | null} */ (sw?.kp ?? null);
        const boulder = /** @type {Record<string, unknown> | null} */ (sw?.boulder_kp ?? null);
        const sfi = /** @type {Record<string, unknown> | null} */ (sw?.sfi ?? null);
        const xray = /** @type {Record<string, unknown> | null} */ (sw?.xray ?? null);
        const aurora = /** @type {Record<string, unknown> | null} */ (sw?.aurora_co ?? null);
        const rows = [
          ['Solar flux (SFI)', sfi?.value != null ? String(Math.round(Number(sfi.value))) : null],
          [
            '90-day mean SFI',
            sfi?.ninety_day_mean != null ? String(Math.round(Number(sfi.ninety_day_mean))) : null,
          ],
          ['Planetary Kp', kp?.value != null ? Number(kp.value).toFixed(1) : null],
          ['Boulder K', boulder?.value != null ? Number(boulder.value).toFixed(1) : null],
          ['X-ray class', xray?.class != null ? String(xray.class) : null],
          [
            'Aurora (Colorado)',
            aurora
              ? `${String(aurora.chance ?? '')}${aurora.detail ? ` — ${String(aurora.detail)}` : ''}`
              : null,
          ],
        ].filter(([, v]) => v != null && v !== '');
        if (rows.length) {
          const h = document.createElement('h3');
          h.className = 'dash-subheading';
          h.textContent = 'Solar & geomagnetic';
          wrap.appendChild(h);
          dl.innerHTML = rows
            .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
            .join('');
          wrap.appendChild(dl);
        }
      }

      const hf = /** @type {Record<string, unknown> | null} */ (sw?.hf ?? null);
      if (hf?.day && hf?.night) {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'HF band conditions (estimate)';
        wrap.appendChild(h);
        if (hf.disclaimer) {
          const disc = document.createElement('p');
          disc.className = 'table-hint';
          disc.textContent = String(hf.disclaimer);
          wrap.appendChild(disc);
        }
        const day = /** @type {Record<string, string>} */ (hf.day);
        const night = /** @type {Record<string, string>} */ (hf.night);
        const bands = ['80m', '40m', '20m', '15m', '10m', '6m'];
        const table = document.createElement('table');
        table.className = 'data-table hf-band-table';
        table.innerHTML = `
          <caption class="sr-only">HF band day and night condition estimates</caption>
          <thead><tr><th scope="col">Band</th><th scope="col">Day</th><th scope="col">Night</th></tr></thead>
          <tbody>
            ${bands
              .map(
                (b) =>
                  `<tr><th scope="row">${escapeHtml(b)}</th><td><span class="hf-rating hf-rating--${escapeHtml(String(day[b] ?? 'poor'))}">${escapeHtml(String(day[b] ?? '—'))}</span></td><td><span class="hf-rating hf-rating--${escapeHtml(String(night[b] ?? 'poor'))}">${escapeHtml(String(night[b] ?? '—'))}</span></td></tr>`,
              )
              .join('')}
          </tbody>`;
        wrap.appendChild(table);
      }

      if (rf) {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'VHF/UHF tropospheric ducting';
        wrap.appendChild(h);
        const status =
          rf.status === 'ducting_likely'
            ? 'Ducting likely'
            : rf.status === 'poor'
              ? 'Poor'
              : 'Nominal';
        const p = document.createElement('p');
        p.className = `rf-badge ${
          rf.status === 'ducting_likely'
            ? 'rf-badge--ducting'
            : rf.status === 'poor'
              ? 'rf-badge--poor'
              : 'rf-badge--nominal'
        }`;
        p.innerHTML = `<span class="rf-badge__status">${escapeHtml(status)}</span><span class="rf-badge__detail">${escapeHtml(String(rf.detail ?? 'Model-derived estimate'))}</span>`;
        wrap.appendChild(p);
      }

      {
        const h = document.createElement('h3');
        h.className = 'dash-subheading';
        h.textContent = 'Official & prop tools';
        wrap.appendChild(h);
        const swLinks = /** @type {Record<string, string>} */ (sw?.links ?? {});
        const linkBits = [];
        if (swLinks.swpc)
          linkBits.push(sourceLink(swLinks.swpc, 'NOAA SWPC', 'btn btn-secondary btn-sm'));
        if (swLinks.scales)
          linkBits.push(
            sourceLink(swLinks.scales, 'NOAA Scales explained', 'btn btn-secondary btn-sm'),
          );
        if (swLinks.drap)
          linkBits.push(sourceLink(swLinks.drap, 'D-RAP absorption', 'btn btn-secondary btn-sm'));
        if (swLinks.prop)
          linkBits.push(sourceLink(swLinks.prop, 'KC2G propagation', 'btn btn-secondary btn-sm'));
        if (pwsLinks.aprs && safeHttpsUrl(String(pwsLinks.aprs))) {
          linkBits.push(
            sourceLink(String(pwsLinks.aprs), 'Nearest PWS on aprs.fi', 'btn btn-secondary btn-sm'),
          );
        }
        const p = document.createElement('p');
        p.className = 'section-cta';
        p.innerHTML = linkBits.join(' ') || 'No offsite links available.';
        wrap.appendChild(p);
      }

      return wrap;
    },
    { open: false },
  );

  const imgUrls = imageryUrls(
    /** @type {number | null} */ (data.lat ?? null),
    /** @type {number | null} */ (data.lon ?? null),
  );

  renderCollapsibleSection(
    sections,
    'links-heading',
    'External tools & sources',
    () => {
      const entries = [
        ['NWS point forecast', links.nws_forecast || imgUrls.nwsForecast],
        ['NOAA / NWS radar', imgUrls.nwsRadar],
        ['CSU CIRA GOES satellite', imgUrls.ciraSlider],
        ['RainViewer full map', links.rainviewer || imgUrls.rainviewer],
        ['Personal weather station (WU)', links.pws],
        ['Pollen.com (nearest ZIP)', links.pollen],
        ['PurpleAir map', links.purpleair_map],
        ['AirNow', links.airnow],
        ['CoAgMET', links.coagmet],
        ['Aviation Weather', links.aviation],
        ['USGS stream gauge', links.usgs],
        ['SNOTEL snowpack', links.snotel],
        ['COtrip traveler map', links.cotrip || 'https://maps.cotrip.org/'],
      ].filter(([, url]) => Boolean(url));

      const webcamLinks = /** @type {{ name?: string, url?: string }[]} */ (
        links.webcam_links ?? []
      );
      for (const w of webcamLinks) {
        if (w?.url && w?.name) entries.push([String(w.name), String(w.url)]);
      }

      if (!entries.length) {
        const frag = document.createDocumentFragment();
        renderEmpty(frag, 'No links', '');
        return frag;
      }
      const note = document.createElement('p');
      note.className = 'table-hint';
      note.textContent =
        'Optional deep-dives open in a new tab. City webcams and WU dashboards are link-outs (not embedded).';
      const ul = document.createElement('ul');
      ul.className = 'link-list';
      entries.forEach(([label, url]) => {
        const safe = safeHttpsUrl(url) || safeExternalUrl(url);
        if (!safe) return;
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = safe;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = String(label);
        a.setAttribute('aria-label', `${label} (opens in new tab)`);
        li.appendChild(a);
        ul.appendChild(li);
      });
      const wrap = document.createDocumentFragment();
      wrap.appendChild(note);
      wrap.appendChild(ul);
      return wrap;
    },
    { open: false },
  );

  renderLiveSourcesPanel(sections, data, metaSources);
  root.appendChild(sections);
  bindDetailJumps(root);
}
