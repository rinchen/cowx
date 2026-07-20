import { escapeHtml, safeHttpsUrl } from './dom.js';
import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { imageryUrls } from './imagery.js';
import { miniBarChartHtml, sparklineHtml } from './sparkline.js';
import { windCellHtml, windCompassHtml, windDirLabel } from './wind.js';

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
 * AQI gradient bar with marker.
 * @param {number} aqi
 * @returns {string}
 */
function aqiBarHtml(aqi) {
  const n = Math.max(0, Math.min(500, Number(aqi)));
  const pct = (n / 500) * 100;
  return `<div class="aqi-bar" role="img" aria-label="AQI ${Math.round(n)} on a 0 to 500 scale"><span class="aqi-bar__marker" style="left:${pct}%"></span></div>`;
}

/**
 * UV gradient bar with marker (0–11+).
 * @param {number} uv
 * @returns {string}
 */
function uvBarHtml(uv) {
  const n = Math.max(0, Number(uv));
  const pct = Math.min(100, (n / 11) * 100);
  return `<div class="uv-bar" role="img" aria-label="UV index ${n} on a 0 to 11 plus scale"><span class="uv-bar__marker" style="left:${pct}%"></span></div>`;
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
 * @param {number | null | undefined} cape
 * @returns {string | null}
 */
function capePlain(cape) {
  if (cape == null || Number.isNaN(Number(cape))) return null;
  const n = Math.round(Number(cape));
  let level = 'Low';
  if (n >= 3500) level = 'Extreme';
  else if (n >= 2500) level = 'High';
  else if (n >= 1000) level = 'Moderate';
  return `${n} J/kg (${level})`;
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
 * Daylight remaining until today's sunset.
 * @param {string | null | undefined} sunsetIso
 * @param {number} [nowMs]
 * @returns {string | null}
 */
function daylightRemaining(sunsetIso, nowMs = Date.now()) {
  if (!sunsetIso) return null;
  try {
    const end = new Date(sunsetIso).getTime();
    const rem = end - nowMs;
    if (rem <= 0) return 'Sunset passed';
    return `${fmtDurationSeconds(rem / 1000)} left`;
  } catch {
    return null;
  }
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
 * Current-conditions jump target. Prefer in-page section ids; absolute URLs go offsite.
 * Hash routing owns `location.hash`, so in-page jumps use data-jump-to + click handler.
 * @param {string} label
 * @param {string} valueHtml — trusted HTML for the value line (already escaped text or SVG)
 * @param {string | null | undefined} [href] — section id (`hourly-heading`) or https URL
 */
function detailItemLinked(label, valueHtml, href) {
  if (valueHtml == null || valueHtml === '') return '';
  if (!href) {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
  }
  const external = /^https?:\/\//i.test(href);
  if (external) {
    return `<div class="summary-detail">
      <a class="detail-jump" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        <span class="detail-jump__label">${escapeHtml(label)}</span>
        <span class="detail-jump__value">${valueHtml}</span>
      </a>
    </div>`;
  }
  return `<div class="summary-detail">
    <a class="detail-jump" href="#${escapeHtml(href)}" data-jump-to="${escapeHtml(href)}">
      <span class="detail-jump__label">${escapeHtml(label)}</span>
      <span class="detail-jump__value">${valueHtml}</span>
    </a>
  </div>`;
}

/**
 * @param {string} label
 * @param {string | null | undefined} value
 * @param {string | null | undefined} [href]
 */
function detailItem(label, value, href) {
  if (value == null || value === '') return '';
  return detailItemLinked(label, escapeHtml(value), href);
}

/**
 * Like detailItem but allows trusted HTML in the value (e.g. wind compass SVG).
 * @param {string} label
 * @param {string | null | undefined} html
 * @param {string | null | undefined} [href]
 */
function detailItemHtml(label, html, href) {
  if (html == null || html === '') return '';
  return detailItemLinked(label, html, href);
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

  if (links.pws) {
    rows.push({
      title: 'Personal weather station',
      body: 'Nearby WUnderground PWS dashboard (live observations offsite)',
      href: String(links.pws),
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
            r.href
              ? `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">Open source</a>`
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
 * @returns {HTMLElement}
 */
function buildDailyTable(daily) {
  const times = /** @type {string[]} */ (daily.time ?? []);
  const showTstorm = seriesHasValues(daily.thunderstorm_probability_max);
  const showSnow = seriesHasValues(daily.snowfall_sum);
  const showPrecipHours = seriesHasValues(daily.precipitation_hours);
  const showDaylight = seriesHasValues(daily.daylight_duration);
  const showEt0 = seriesHasValues(daily.et0_fao_evapotranspiration);

  /** @type {{ key: string, label: string, optional?: boolean }[]} */
  const cols = [
    { key: 'day', label: 'Day' },
    { key: 'cond', label: 'Cond.' },
    { key: 'high', label: 'High' },
    { key: 'low', label: 'Low' },
    { key: 'precipPct', label: 'Precip %' },
    { key: 'precipIn', label: 'Precip in' },
  ];
  if (showSnow) cols.push({ key: 'snow', label: 'Snow', optional: true });
  if (showPrecipHours) cols.push({ key: 'precipHours', label: 'Precip hrs', optional: true });
  cols.push({ key: 'wind', label: 'Wind' }, { key: 'gust', label: 'Gust' });
  if (showTstorm) cols.push({ key: 'tstorm', label: 'Tstorm %' });
  cols.push({ key: 'uv', label: 'UV' });
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
    const precipPct = /** @type {number[]} */ (daily.precipitation_probability_max ?? [])[i];
    const precipSum = /** @type {number[]} */ (daily.precipitation_sum ?? [])[i];
    const snow = /** @type {number[]} */ (daily.snowfall_sum ?? [])[i];
    const precipHours = /** @type {number[]} */ (daily.precipitation_hours ?? [])[i];
    const windMax = /** @type {number[]} */ (daily.wind_speed_10m_max ?? [])[i];
    const windDir = /** @type {number[]} */ (daily.wind_direction_10m_dominant ?? [])[i];
    const gustMax = /** @type {number[]} */ (daily.wind_gusts_10m_max ?? [])[i];
    const tstormMax = /** @type {number[]} */ (daily.thunderstorm_probability_max ?? [])[i];
    const uvMax = /** @type {number[]} */ (daily.uv_index_max ?? [])[i];
    const daylight = /** @type {number[]} */ (daily.daylight_duration ?? [])[i];
    const et0 = /** @type {number[]} */ (daily.et0_fao_evapotranspiration ?? [])[i];
    const code = /** @type {number[]} */ (daily.weather_code ?? [])[i];
    const rise = /** @type {string[]} */ (daily.sunrise ?? [])[i];
    const set = /** @type {string[]} */ (daily.sunset ?? [])[i];
    /** @type {Record<string, string>} */
    const cellByKey = {
      day: `<td class="sticky-col col-day" data-col="day">${fmtDate(times[i])}</td>`,
      cond: `<td class="cond-cell col-cond" data-col="cond">${weatherIconHtml(code, { isDay: true, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>`,
      high: `<td class="col-high" data-col="high">${hi != null ? `${Math.round(hi)}°F` : '—'}</td>`,
      low: `<td class="col-low" data-col="low">${lo != null ? `${Math.round(lo)}°F` : '—'}</td>`,
      precipPct: `<td class="col-precipPct" data-col="precipPct">${precipPct != null ? `${precipPct}%` : '—'}</td>`,
      precipIn: `<td class="col-precipIn" data-col="precipIn">${precipSum != null ? `${Number(precipSum).toFixed(2)}` : '—'}</td>`,
      snow: `<td class="col-snow" data-col="snow">${snow != null ? Number(snow).toFixed(2) : '—'}</td>`,
      precipHours: `<td class="col-precipHours" data-col="precipHours">${precipHours != null ? String(precipHours) : '—'}</td>`,
      wind: `<td class="wind-td col-wind" data-col="wind">${windCellHtml(windDir, windMax, { size: 24 })}</td>`,
      gust: `<td class="col-gust" data-col="gust">${gustMax != null ? `${Math.round(gustMax)} mph` : '—'}</td>`,
      tstorm: `<td class="col-tstorm" data-col="tstorm">${tstormMax != null ? `${Math.round(Number(tstormMax))}%` : '—'}</td>`,
      uv: `<td class="col-uv" data-col="uv">${uvMax != null ? String(uvMax) : '—'}</td>`,
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
 * @param {string[]} times
 * @returns {number}
 */
function nearestHourIndex(times) {
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/**
 * Approximate golden hour windows: first hour after sunrise, last hour before sunset.
 * @param {string | null | undefined} sunriseIso
 * @param {string | null | undefined} sunsetIso
 * @returns {{ morning: string | null, evening: string | null }}
 */
function goldenHourWindows(sunriseIso, sunsetIso) {
  if (!sunriseIso || !sunsetIso) return { morning: null, evening: null };
  try {
    const rise = new Date(sunriseIso);
    const set = new Date(sunsetIso);
    const morningEnd = new Date(rise.getTime() + 60 * 60_000);
    const eveningStart = new Date(set.getTime() - 60 * 60_000);
    return {
      morning: `${fmtClock(rise.toISOString())}–${fmtClock(morningEnd.toISOString())}`,
      evening: `${fmtClock(eveningStart.toISOString())}–${fmtClock(set.toISOString())}`,
    };
  } catch {
    return { morning: null, evening: null };
  }
}

/**
 * @param {Record<string, unknown> | null} airnow
 * @param {Record<string, unknown> | null} purpleair
 * @param {Record<string, unknown> | null} omaq
 * @returns {string | null}
 */
function airQualityPlain(airnow, purpleair, omaq) {
  if (airnow?.aqi != null) {
    const cat = airnow.category ? String(airnow.category) : '';
    const param = airnow.parameter ? String(airnow.parameter) : '';
    const area = airnow.reporting_area ? String(airnow.reporting_area) : '';
    const parts = [`AQI ${airnow.aqi}`];
    if (cat) parts.unshift(cat);
    if (param) parts.push(`(${param})`);
    let line = parts.join(' ');
    if (area) line += ` near ${area}`;
    return line;
  }
  if (purpleair?.aqi_pm25 != null) {
    return `About AQI ${purpleair.aqi_pm25} from a nearby PurpleAir sensor${purpleair.pm25 != null ? ` (PM2.5 ${purpleair.pm25} µg/m³)` : ''}`;
  }
  if (omaq?.us_aqi != null) {
    return `Model US AQI ${omaq.us_aqi}${omaq.pm25 != null ? ` · PM2.5 ${omaq.pm25} µg/m³` : ''}`;
  }
  return null;
}

/**
 * @param {Record<string, unknown>[]} alerts
 * @returns {string}
 */
function alertsPlain(alerts) {
  if (!alerts.length) return 'No active weather alerts';
  return alerts
    .map((a) => {
      const event = String(a.event ?? a.headline ?? 'Alert');
      const sev = a.severity ? ` (${a.severity})` : '';
      return `${event}${sev}`;
    })
    .join('; ');
}

/**
 * @param {number | null | undefined} uv
 * @returns {string | null}
 */
function uvPlain(uv) {
  if (uv == null || Number.isNaN(Number(uv))) return null;
  const n = Number(uv);
  let level = 'Low';
  if (n >= 11) level = 'Extreme';
  else if (n >= 8) level = 'Very high';
  else if (n >= 6) level = 'High';
  else if (n >= 3) level = 'Moderate';
  return `${n} (${level})`;
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {(slug: string) => boolean} onFavoriteToggle
 * @param {boolean} [starred]
 * @param {{ sources?: unknown[] }} [options]
 */
export function renderDashboard(root, data, onFavoriteToggle, starred = false, options = {}) {
  root.innerHTML = '';
  const metaSources = Array.isArray(options.sources) ? options.sources : [];
  const slug = String(data.slug ?? '');
  const current = /** @type {Record<string, unknown> | null} */ (data.current ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const links = /** @type {Record<string, string | null>} */ (data.links ?? {});
  const sunrises = /** @type {string[]} */ (daily?.sunrise ?? []);
  const sunsets = /** @type {string[]} */ (daily?.sunset ?? []);
  const elevationFt =
    data.elevation_ft != null && !Number.isNaN(Number(data.elevation_ft))
      ? Number(data.elevation_ft)
      : null;
  const currentIsDay =
    current?.is_day === 0 || current?.is_day === 1
      ? current.is_day === 1
      : isDaytime(new Date().toISOString(), sunrises, sunsets);
  const nowIsDay = currentIsDay;

  const header = document.createElement('header');
  header.className = 'dashboard-header';
  header.innerHTML = `
    <div class="dashboard-title-row">
      <h1 id="location-name">${escapeHtml(String(data.name ?? slug))}</h1>
      <button type="button" class="btn-favorite" id="btn-favorite" aria-pressed="${starred}" aria-label="${starred ? 'Remove from favorites' : 'Add to favorites'}">
        <span aria-hidden="true">${starred ? '★' : '☆'}</span>
      </button>
    </div>
    <p class="location-meta">
      ${data.county ? `<span>${escapeHtml(String(data.county))} County</span>` : ''}
      ${data.elevation_ft != null ? `<span>${Number(data.elevation_ft).toLocaleString()} ft</span>` : ''}
      ${data.region ? `<span>${escapeHtml(String(data.region))}</span>` : ''}
      ${data.wfo ? `<span>NWS ${escapeHtml(String(data.wfo))}</span>` : ''}
      ${data.lat != null && data.lon != null ? `<span>${Number(data.lat).toFixed(2)}, ${Number(data.lon).toFixed(2)}</span>` : ''}
    </p>
  `;
  root.appendChild(header);

  if (data.forecastStale) {
    const banner = document.createElement('p');
    banner.className = 'stale-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Showing last successful forecast — a newer model pull was rate-limited.';
    root.appendChild(banner);
  }

  const summarySection = document.createElement('section');
  summarySection.className = 'summary-card';
  summarySection.setAttribute('aria-labelledby', 'summary-heading');

  if (!current || current.temp_f == null) {
    summarySection.innerHTML = `
      <h2 id="summary-heading">Current conditions</h2>
      <p class="empty-state"><strong>Forecast temporarily unavailable.</strong>
        Source may be rate-limited or stale. Other live sections below may still have data.</p>
      ${data.updatedAt ? `<p class="updated-at">Location data updated ${fmtDateTime(String(data.updatedAt))}</p>` : ''}
    `;
  } else {
    const hourlyNow = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
    const hourTimes = /** @type {string[]} */ (hourlyNow?.time ?? []);
    const hi = hourTimes.length ? nearestHourIndex(hourTimes) : 0;
    const precipChance =
      hourlyNow && Array.isArray(hourlyNow.precipitation_probability)
        ? /** @type {number[]} */ (hourlyNow.precipitation_probability)[hi]
        : null;
    const hourVis =
      hourlyNow && Array.isArray(hourlyNow.visibility)
        ? /** @type {number[]} */ (hourlyNow.visibility)[hi]
        : null;
    const hourDew =
      hourlyNow && Array.isArray(hourlyNow.dewpoint_2m)
        ? /** @type {number[]} */ (hourlyNow.dewpoint_2m)[hi]
        : null;

    const todayHi = /** @type {number[]} */ (daily?.temperature_2m_max ?? [])[0];
    const todayLo = /** @type {number[]} */ (daily?.temperature_2m_min ?? [])[0];
    const sunrise = sunrises[0] ?? null;
    const sunset = sunsets[0] ?? null;
    const golden = goldenHourWindows(sunrise, sunset);

    const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
    const alertText = alertsPlain(alerts);
    const hasAlerts = alerts.length > 0;

    const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
    const purpleair = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
    const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
    const aq = airQualityPlain(airnow, purpleair, omaq);

    const aviation = /** @type {Record<string, unknown> | null} */ (data.aviation ?? null);
    const flightCat =
      aviation?.flight_category != null
        ? `${aviation.flight_category}${aviation.icao ? ` at ${aviation.icao}` : ''}`
        : null;

    const windDeg = /** @type {number | null} */ (current.wind_dir_deg ?? null);
    const windDir = windDirLabel(windDeg);
    const windSpeedBits = [];
    if (current.wind_speed_mph != null) {
      windSpeedBits.push(`${Math.round(Number(current.wind_speed_mph))} mph`);
    }
    if (current.wind_gust_mph != null) {
      windSpeedBits.push(`gusts ${Math.round(Number(current.wind_gust_mph))} mph`);
    }
    const windHtmlParts = [];
    const compass = windCompassHtml(windDeg, { size: 32 });
    if (compass) windHtmlParts.push(compass);
    if (windSpeedBits.length || windDir) {
      const speedLine = windSpeedBits.length
        ? `<span class="wind-cell__mph">${escapeHtml(windSpeedBits.join(' · '))}</span>`
        : '';
      const dirLine = windDir
        ? `<span class="wind-cell__dir">from ${escapeHtml(windDir)}</span>`
        : '';
      windHtmlParts.push(`<span class="wind-cell__speed">${speedLine}${dirLine}</span>`);
    }
    const windHtml = windHtmlParts.length
      ? `<span class="wind-cell wind-cell--summary">${windHtmlParts.join('')}</span>`
      : null;

    const tstormNow =
      current.thunderstorm_probability != null
        ? `${Math.round(Number(current.thunderstorm_probability))}%`
        : hourlyNow && Array.isArray(hourlyNow.thunderstorm_probability)
          ? (() => {
              const v = /** @type {number[]} */ (hourlyNow.thunderstorm_probability)[hi];
              return v != null ? `${Math.round(Number(v))}%` : null;
            })()
          : null;

    const code = /** @type {number | null} */ (current.weather_code ?? null);
    const precipIn =
      current.precip_in != null ? `${Number(current.precip_in).toFixed(2)} in this hour` : null;

    const alertBody = hasAlerts
      ? `<strong>Alerts:</strong> ${escapeHtml(alertText)}`
      : '<strong>Alerts:</strong> None active for this area.';

    const hourFreeze =
      hourlyNow && Array.isArray(hourlyNow.freezing_level_height)
        ? /** @type {number[]} */ (hourlyNow.freezing_level_height)[hi]
        : null;
    const hourCape =
      hourlyNow && Array.isArray(hourlyNow.cape)
        ? /** @type {number[]} */ (hourlyNow.cape)[hi]
        : null;
    const hourSnow =
      hourlyNow && Array.isArray(hourlyNow.snowfall)
        ? /** @type {number[]} */ (hourlyNow.snowfall)[hi]
        : null;
    const snowLine =
      hourSnow != null && Number(hourSnow) > 0
        ? `${Number(hourSnow).toFixed(2)} in this hour`
        : null;
    const daylightLeft = daylightRemaining(sunset);

    const pressureMb =
      current.surface_pressure_mb != null ? current.surface_pressure_mb : current.pressure_mb;

    summarySection.innerHTML = `
      <h2 id="summary-heading">Current conditions</h2>
      <p class="summary-alert ${hasAlerts ? 'summary-alert--active' : 'summary-alert--clear'}" role="status">
        <a class="detail-jump detail-jump--alert" href="#alerts-heading" data-jump-to="alerts-heading">${alertBody}</a>
      </p>
      <div class="summary-grid">
        <div class="summary-primary">
          <a class="detail-jump detail-jump--primary" href="#hourly-heading" data-jump-to="hourly-heading">
            ${weatherIconHtml(code, { isDay: nowIsDay, size: 72, className: 'weather-icon weather-icon--lg', alt: String(current.condition ?? wmoLabel(code)) })}
            <p class="summary-temp" aria-label="Temperature">
              ${Math.round(Number(current.temp_f))}°F
              ${(() => {
                const temps = /** @type {number[]} */ (hourlyNow?.temperature_2m ?? []).slice(
                  Math.max(0, hi - 11),
                  hi + 1,
                );
                const spark = sparklineHtml(temps, { width: 72, height: 22, fill: true });
                return spark ? `<span class="summary-spark">${spark}</span>` : '';
              })()}
            </p>
            <p class="summary-conditions">${escapeHtml(String(current.condition ?? wmoLabel(code)))}</p>
          </a>
        </div>
        <dl class="summary-details">
          ${detailItem('Feels like', current.feels_like_f != null ? `${Math.round(Number(current.feels_like_f))}°F` : null, 'hourly-heading')}
          ${detailItem('Today’s range', todayHi != null && todayLo != null ? `High ${Math.round(todayHi)}°F · Low ${Math.round(todayLo)}°F` : null, 'daily-heading')}
          ${detailItemHtml(
            'Chance of precip',
            precipChance != null
              ? `<span>${precipChance}% this hour</span>${(() => {
                  const probs = /** @type {number[]} */ (
                    hourlyNow?.precipitation_probability ?? []
                  ).slice(hi, hi + 12);
                  const bars = miniBarChartHtml(probs, { width: 72, height: 18 });
                  return bars ? `<span class="summary-spark">${bars}</span>` : '';
                })()}`
              : null,
            'hourly-heading',
          )}
          ${detailItem('Precipitation', precipIn, 'hourly-heading')}
          ${detailItem('Snowfall', snowLine, snowLine ? 'hourly-heading' : null)}
          ${detailItem('Humidity', current.humidity != null ? `${current.humidity}%` : null, 'hourly-heading')}
          ${detailItem('Dewpoint', hourDew != null ? `${Math.round(hourDew)}°F` : null, 'hourly-heading')}
          ${detailItemHtml('Wind', windHtml, 'hourly-heading')}
          ${detailItem('Thunderstorm', tstormNow, 'hourly-heading')}
          ${detailItem('CAPE', capePlain(hourCape), hourCape != null ? 'hourly-heading' : null)}
          ${detailItem('Freezing level', fmtFreezingLevelFt(hourFreeze), hourFreeze != null ? 'hourly-heading' : null)}
          ${detailItem('Visibility', hourVis != null ? fmtVisibility(hourVis) : null, 'hourly-heading')}
          ${detailItem('Cloud cover', current.cloud_cover != null ? `${current.cloud_cover}%` : null, 'hourly-heading')}
          ${detailItem('Pressure', pressureMb != null ? `${Math.round(Number(pressureMb))} mb` : null, 'sources-heading')}
          ${detailItemHtml(
            'UV index',
            (() => {
              const plain = uvPlain(/** @type {number | null} */ (current.uv_index ?? null));
              if (!plain) return null;
              const bar = current.uv_index != null ? uvBarHtml(Number(current.uv_index)) : '';
              return `<span>${escapeHtml(plain)}</span>${bar}`;
            })(),
            'daily-heading',
          )}
          ${detailItemHtml(
            'Air quality',
            (() => {
              if (!aq) return null;
              let aqiNum = null;
              if (airnow?.aqi != null) aqiNum = Number(airnow.aqi);
              else if (purpleair?.aqi_pm25 != null) aqiNum = Number(purpleair.aqi_pm25);
              else if (omaq?.us_aqi != null) aqiNum = Number(omaq.us_aqi);
              const bar = aqiNum != null && Number.isFinite(aqiNum) ? aqiBarHtml(aqiNum) : '';
              return `<span>${escapeHtml(aq)}</span>${bar}`;
            })(),
            aq ? 'aqi-heading' : null,
          )}
          ${detailItem('Sunrise', sunrise ? fmtClock(sunrise) : null, 'daily-heading')}
          ${detailItem('Sunset', sunset ? fmtClock(sunset) : null, 'daily-heading')}
          ${detailItem('Daylight remaining', daylightLeft, daylightLeft ? 'daily-heading' : null)}
          ${detailItem('Morning golden hour', golden.morning, 'daily-heading')}
          ${detailItem('Evening golden hour', golden.evening, 'daily-heading')}
          ${detailItem('Aviation', flightCat, flightCat ? 'metar-heading' : null)}
          ${(() => {
            const usgs = /** @type {Record<string, unknown> | null} */ (data.usgs ?? null);
            if (!usgs || usgs.discharge_cfs == null) return '';
            const name = String(usgs.station_name ?? usgs.station_id ?? 'USGS gauge');
            const short = name.length > 40 ? `${name.slice(0, 37)}…` : name;
            const cfs = `${Math.round(Number(usgs.discharge_cfs))} cfs`;
            return detailItem('Streamflow', `${short}: ${cfs}`, 'hydrology-heading');
          })()}
        </dl>
      </div>
      ${data.updatedAt ? `<p class="updated-at">Location snapshot ${fmtDateTime(String(data.updatedAt))} · <a class="detail-jump detail-jump--inline" href="#sources-heading" data-jump-to="sources-heading">Live data sources</a></p>` : ''}
    `;
  }
  root.appendChild(summarySection);
  bindDetailJumps(summarySection);

  appendDeepForecast(root, data, {
    sources: metaSources,
    sunrises,
    sunsets,
    elevationFt,
    links,
    includeMapSlot: true,
  });

  const favBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#btn-favorite'));
  favBtn?.addEventListener('click', () => {
    const next = onFavoriteToggle(slug);
    favBtn.setAttribute('aria-pressed', String(next));
    favBtn.setAttribute('aria-label', next ? 'Remove from favorites' : 'Add to favorites');
    const span = favBtn.querySelector('span');
    if (span) span.textContent = next ? '★' : '☆';
  });
}

/**
 * Hourly/daily tables + collapsible detail sections (no summary header or map).
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{ sources?: unknown[], includeMapSlot?: boolean }} [options]
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
 * }} ctx
 */
function appendDeepForecast(root, data, ctx) {
  const { sunrises, sunsets, elevationFt, links, sources: metaSources } = ctx;
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);

  if (!hourly?.time || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    const empty = document.createElement('div');
    renderEmpty(
      empty,
      'No hourly data',
      data.forecastStale
        ? 'Prior forecast also lacked hourly rows.'
        : 'Forecast temporarily unavailable (source rate-limited or failed this run).',
    );
    renderForecastCard(root, 'hourly-heading', 'Hourly forecast (48h)', empty);
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
    renderForecastCard(root, 'daily-heading', 'Daily forecast (10 day)', empty);
  } else {
    renderForecastCard(
      root,
      'daily-heading',
      'Daily forecast (10 day)',
      buildDailyTable(/** @type {Record<string, unknown>} */ (daily)),
    );
  }

  if (ctx.includeMapSlot) {
    const mapSlot = document.createElement('div');
    mapSlot.id = 'map-slot';
    mapSlot.className = 'map-slot';
    mapSlot.innerHTML = `
    <section class="map-section" aria-labelledby="map-heading">
      <h2 id="map-heading">Local map &amp; radar</h2>
      <p class="map-lead">Regional view with RainViewer radar (zoom fixed for supported radar tiles). Alert polygons load when available.</p>
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
    { open: true },
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
    'Air quality',
    () => {
      const an = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
      const pa = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
      const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
      if (!an && !pa && !omaq) {
        const frag = document.createDocumentFragment();
        renderEmpty(
          frag,
          'No air quality data',
          'No AirNow, PurpleAir, or model AQ reading nearby.',
        );
        return frag;
      }
      const wrap = document.createDocumentFragment();
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
        if (pa.humidity != null) parts.push(`<dt>PurpleAir humidity</dt><dd>${pa.humidity}%</dd>`);
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
        ['Personal weather station', links.pws],
        ['PurpleAir map', links.purpleair_map],
        ['AirNow', links.airnow],
        ['CoAgMET', links.coagmet],
        ['Aviation Weather', links.aviation],
        ['USGS stream gauge', links.usgs],
        ['SNOTEL snowpack', links.snotel],
      ].filter(([, url]) => Boolean(url));
      if (!entries.length) {
        const frag = document.createDocumentFragment();
        renderEmpty(frag, 'No links', '');
        return frag;
      }
      const note = document.createElement('p');
      note.className = 'table-hint';
      note.textContent =
        'Optional deep-dives. Forecast tables and the map above already show on-page detail.';
      const ul = document.createElement('ul');
      ul.className = 'link-list';
      entries.forEach(([label, url]) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = String(url);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = String(label);
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
