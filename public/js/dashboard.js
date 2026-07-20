import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { imageryUrls } from './imagery.js';
import { windCellHtml, windCompassHtml, windDirLabel } from './wind.js';

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
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
 * Always-visible live source references for this locality snapshot.
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
  const afd = /** @type {Record<string, unknown> | null} */ (data.afd ?? null);
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
    body: `National Weather Service${alerts.length ? ` · ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}` : ' · no active alerts'}${afd?.office ? ` · AFD ${afd.office}` : ''}${afd?.issued ? ` issued ${fmtDateTime(String(afd.issued))}` : ''}${nwsInfo.fetchedAt ? ` · fetched ${fmtDateTime(nwsInfo.fetchedAt)}` : ''}${sourceStatusNote(nwsInfo.status)}`,
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

  rows.push({
    title: 'Radar overlay',
    body: 'RainViewer live tiles on the map below (refreshed from their public weather-maps API)',
    href: links.rainviewer || 'https://www.rainviewer.com/',
  });

  if (links.pws) {
    rows.push({
      title: 'Personal weather station',
      body: 'Nearby WUnderground PWS dashboard (live observations offsite)',
      href: String(links.pws),
    });
  }

  const section = document.createElement('section');
  section.className = 'sources-card';
  section.setAttribute('aria-labelledby', 'sources-heading');
  section.innerHTML = `
    <h2 id="sources-heading">Live data sources</h2>
    <p class="sources-lead">
      This page is a Colorado snapshot refreshed about every 45 minutes. Values below name the
      upstream feed and when we last pulled it — open a link for the provider’s live product.
    </p>
    <ul class="sources-list">
      ${rows
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
        .join('')}
    </ul>
    <p class="sources-footer">
      Full attribution:
      <a href="credits.html">Credits</a>
      ·
      <a href="how-it-works.html">How it works</a>
    </p>
  `;
  parent.appendChild(section);
}

/**
 * @param {string} href
 * @param {string} label
 * @param {string} [className]
 */
function sourceLink(href, label, className = 'btn btn-secondary btn-sm') {
  if (!href) return '';
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
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
 * @returns {HTMLElement}
 */
function buildHourlyTable(hourly, sunrises, sunsets) {
  const times = /** @type {string[]} */ (hourly.time).slice(0, 48);
  const showFeels = seriesHasValues(hourly.apparent_temperature);
  const showPrecipPct = seriesHasValues(hourly.precipitation_probability);
  const showPrecipIn = seriesHasValues(hourly.precipitation);
  const showWind =
    seriesHasValues(hourly.wind_speed_10m) || seriesHasValues(hourly.wind_direction_10m);
  const showGust = seriesHasValues(hourly.wind_gusts_10m);
  const showTstorm = seriesHasValues(hourly.thunderstorm_probability);
  const showRh = seriesHasValues(hourly.relative_humidity_2m);
  const showDew = seriesHasValues(hourly.dewpoint_2m);
  const showCloud = seriesHasValues(hourly.cloud_cover);
  const showUv = seriesHasValues(hourly.uv_index);
  const showVis = seriesHasValues(hourly.visibility);

  const headers = ['Time', 'Cond.', 'Temp'];
  if (showFeels) headers.push('Feels');
  if (showPrecipPct) headers.push('Precip %');
  if (showPrecipIn) headers.push('Precip in');
  if (showWind) headers.push('Wind');
  if (showGust) headers.push('Gust');
  if (showTstorm) headers.push('Tstorm %');
  if (showRh) headers.push('RH');
  if (showDew) headers.push('Dew');
  if (showCloud) headers.push('Cloud');
  if (showUv) headers.push('UV');
  if (showVis) headers.push('Vis');

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table data-table--dense data-table--forecast';
  table.innerHTML = `
    <caption class="sr-only">48-hour hourly forecast</caption>
    <thead><tr>${headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
  `;
  const tbody = document.createElement('tbody');
  times.forEach((t, i) => {
    const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
    const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
    const feels = /** @type {number[]} */ (hourly.apparent_temperature ?? [])[i];
    const precipPct = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
    const precipIn = /** @type {number[]} */ (hourly.precipitation ?? [])[i];
    const wind = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
    const windDir = /** @type {number[]} */ (hourly.wind_direction_10m ?? [])[i];
    const gust = /** @type {number[]} */ (hourly.wind_gusts_10m ?? [])[i];
    const tstorm = /** @type {number[]} */ (hourly.thunderstorm_probability ?? [])[i];
    const rh = /** @type {number[]} */ (hourly.relative_humidity_2m ?? [])[i];
    const dew = /** @type {number[]} */ (hourly.dewpoint_2m ?? [])[i];
    const cloud = /** @type {number[]} */ (hourly.cloud_cover ?? [])[i];
    const uv = /** @type {number[]} */ (hourly.uv_index ?? [])[i];
    const vis = /** @type {number[]} */ (hourly.visibility ?? [])[i];
    const day = isDaytime(t, sunrises, sunsets);
    const cells = [
      `<td class="sticky-col">${escapeHtml(fmtTime(t))}</td>`,
      `<td class="cond-cell">${weatherIconHtml(code, { isDay: day, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>`,
      `<td>${temp != null ? `${Math.round(temp)}°F` : '—'}</td>`,
    ];
    if (showFeels) cells.push(`<td>${feels != null ? `${Math.round(feels)}°F` : '—'}</td>`);
    if (showPrecipPct) cells.push(`<td>${precipPct != null ? `${precipPct}%` : '—'}</td>`);
    if (showPrecipIn) {
      cells.push(`<td>${precipIn != null ? Number(precipIn).toFixed(2) : '—'}</td>`);
    }
    if (showWind)
      cells.push(`<td class="wind-td">${windCellHtml(windDir, wind, { size: 24 })}</td>`);
    if (showGust) cells.push(`<td>${gust != null ? `${Math.round(gust)} mph` : '—'}</td>`);
    if (showTstorm)
      cells.push(`<td>${tstorm != null ? `${Math.round(Number(tstorm))}%` : '—'}</td>`);
    if (showRh) cells.push(`<td>${rh != null ? `${rh}%` : '—'}</td>`);
    if (showDew) cells.push(`<td>${dew != null ? `${Math.round(dew)}°F` : '—'}</td>`);
    if (showCloud) cells.push(`<td>${cloud != null ? `${cloud}%` : '—'}</td>`);
    if (showUv) cells.push(`<td>${uv != null ? String(uv) : '—'}</td>`);
    if (showVis) cells.push(`<td>${fmtVisibility(vis)}</td>`);
    const tr = document.createElement('tr');
    tr.innerHTML = cells.join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/**
 * @param {Record<string, unknown>} daily
 * @returns {HTMLElement}
 */
function buildDailyTable(daily) {
  const times = /** @type {string[]} */ (daily.time ?? []);
  const showTstorm = seriesHasValues(daily.thunderstorm_probability_max);
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table data-table--dense data-table--forecast';
  const tstormTh = showTstorm ? '<th scope="col">Tstorm %</th>' : '';
  table.innerHTML = `
    <caption class="sr-only">10-day daily forecast</caption>
    <thead>
      <tr>
        <th scope="col">Day</th>
        <th scope="col">Cond.</th>
        <th scope="col">High</th>
        <th scope="col">Low</th>
        <th scope="col">Precip %</th>
        <th scope="col">Precip in</th>
        <th scope="col">Wind</th>
        <th scope="col">Gust</th>
        ${tstormTh}
        <th scope="col">UV</th>
        <th scope="col">Sunrise</th>
        <th scope="col">Sunset</th>
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
    const windMax = /** @type {number[]} */ (daily.wind_speed_10m_max ?? [])[i];
    const windDir = /** @type {number[]} */ (daily.wind_direction_10m_dominant ?? [])[i];
    const gustMax = /** @type {number[]} */ (daily.wind_gusts_10m_max ?? [])[i];
    const tstormMax = /** @type {number[]} */ (daily.thunderstorm_probability_max ?? [])[i];
    const uvMax = /** @type {number[]} */ (daily.uv_index_max ?? [])[i];
    const code = /** @type {number[]} */ (daily.weather_code ?? [])[i];
    const rise = /** @type {string[]} */ (daily.sunrise ?? [])[i];
    const set = /** @type {string[]} */ (daily.sunset ?? [])[i];
    const tstormTd = showTstorm
      ? `<td>${tstormMax != null ? `${Math.round(Number(tstormMax))}%` : '—'}</td>`
      : '';
    tr.innerHTML = `
      <td class="sticky-col">${fmtDate(times[i])}</td>
      <td class="cond-cell">${weatherIconHtml(code, { isDay: true, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>
      <td>${hi != null ? `${Math.round(hi)}°F` : '—'}</td>
      <td>${lo != null ? `${Math.round(lo)}°F` : '—'}</td>
      <td>${precipPct != null ? `${precipPct}%` : '—'}</td>
      <td>${precipSum != null ? `${Number(precipSum).toFixed(2)}` : '—'}</td>
      <td class="wind-td">${windCellHtml(windDir, windMax, { size: 24 })}</td>
      <td>${gustMax != null ? `${Math.round(gustMax)} mph` : '—'}</td>
      ${tstormTd}
      <td>${uvMax != null ? String(uvMax) : '—'}</td>
      <td>${fmtClock(rise)}</td>
      <td>${fmtClock(set)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
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
  const nowIsDay = isDaytime(new Date().toISOString(), sunrises, sunsets);

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
            </p>
            <p class="summary-conditions">${escapeHtml(String(current.condition ?? wmoLabel(code)))}</p>
          </a>
        </div>
        <dl class="summary-details">
          ${detailItem('Feels like', current.feels_like_f != null ? `${Math.round(Number(current.feels_like_f))}°F` : null, 'hourly-heading')}
          ${detailItem('Today’s range', todayHi != null && todayLo != null ? `High ${Math.round(todayHi)}°F · Low ${Math.round(todayLo)}°F` : null, 'daily-heading')}
          ${detailItem('Chance of precip', precipChance != null ? `${precipChance}% this hour` : null, 'hourly-heading')}
          ${detailItem('Precipitation', precipIn, 'hourly-heading')}
          ${detailItem('Humidity', current.humidity != null ? `${current.humidity}%` : null, 'hourly-heading')}
          ${detailItem('Dewpoint', hourDew != null ? `${Math.round(hourDew)}°F` : null, 'hourly-heading')}
          ${detailItemHtml('Wind', windHtml, 'hourly-heading')}
          ${detailItem('Thunderstorm', tstormNow, 'hourly-heading')}
          ${detailItem('Visibility', hourVis != null ? fmtVisibility(hourVis) : null, 'hourly-heading')}
          ${detailItem('Cloud cover', current.cloud_cover != null ? `${current.cloud_cover}%` : null, 'hourly-heading')}
          ${detailItem('Pressure', current.pressure_mb != null ? `${Math.round(Number(current.pressure_mb))} mb` : null, 'sources-heading')}
          ${detailItem('UV index', uvPlain(/** @type {number | null} */ (current.uv_index ?? null)), 'daily-heading')}
          ${detailItem('Air quality', aq, aq ? 'aqi-heading' : null)}
          ${detailItem('Sunrise', sunrise ? fmtClock(sunrise) : null, 'daily-heading')}
          ${detailItem('Sunset', sunset ? fmtClock(sunset) : null, 'daily-heading')}
          ${detailItem('Morning golden hour', golden.morning, 'daily-heading')}
          ${detailItem('Evening golden hour', golden.evening, 'daily-heading')}
          ${detailItem('Aviation', flightCat, flightCat ? 'metar-heading' : null)}
        </dl>
      </div>
      ${data.updatedAt ? `<p class="updated-at">Location snapshot ${fmtDateTime(String(data.updatedAt))} · <a class="detail-jump detail-jump--inline" href="#sources-heading" data-jump-to="sources-heading">Live data sources</a></p>` : ''}
    `;
  }
  root.appendChild(summarySection);
  bindDetailJumps(summarySection);

  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
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
      buildHourlyTable(hourly, sunrises, sunsets),
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
          `<dt>AirNow AQI</dt><dd>${an.aqi ?? '—'} ${an.category ? `(${escapeHtml(String(an.category))})` : ''}</dd>`,
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
        parts.push(
          `<dt>Model US AQI</dt><dd>${omaq.us_aqi != null ? String(omaq.us_aqi) : '—'}</dd>`,
        );
        parts.push(
          `<dt>Model European AQI</dt><dd>${omaq.european_aqi != null ? String(omaq.european_aqi) : '—'}</dd>`,
        );
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

  root.appendChild(sections);
  renderLiveSourcesPanel(root, data, metaSources);

  const favBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#btn-favorite'));
  favBtn?.addEventListener('click', () => {
    const next = onFavoriteToggle(slug);
    favBtn.setAttribute('aria-pressed', String(next));
    favBtn.setAttribute('aria-label', next ? 'Remove from favorites' : 'Add to favorites');
    const span = favBtn.querySelector('span');
    if (span) span.textContent = next ? '★' : '☆';
  });
}
