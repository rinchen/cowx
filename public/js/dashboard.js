import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { renderImagerySection } from './imagery.js';

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
 * @param {number | null | undefined} deg
 * @returns {string | null}
 */
function windDirLabel(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const normalized = ((Number(deg) % 360) + 360) % 360;
  const i = Math.round(normalized / 22.5) % 16;
  return `${dirs[i]} (${Math.round(Number(deg))}°)`;
}

/**
 * Open-Meteo visibility is meters when requested with imperial temp/wind/precip.
 * @param {number | null | undefined} meters
 */
function fmtVisibility(meters) {
  if (meters == null || Number.isNaN(Number(meters))) return null;
  const miles = Number(meters) / 1609.34;
  if (miles >= 10) return `${Math.round(miles)} mi`;
  return `${miles.toFixed(1)} mi`;
}

/**
 * CoAgMET sentinel for missing soil sensors.
 * @param {unknown} v
 */
function coagValue(v) {
  if (v == null || v === '' || v === -999 || v === '-999') return null;
  return v;
}

/**
 * @param {string} label
 * @param {string | null | undefined} value
 */
function detailItem(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
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
 * @param {() => (Node | null)} renderBody
 * @param {string} [actionsHtml]
 */
function renderCollapsibleSection(parent, headingId, title, renderBody, actionsHtml = '') {
  const body = renderBody();
  if (body == null) return;

  const details = document.createElement('details');
  details.className = 'dash-section';
  details.open = true;
  const summary = document.createElement('summary');
  summary.id = headingId;
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
 * @param {number} i
 * @param {string[]} sunrises
 * @param {string[]} sunsets
 */
function renderHourDetails(hourly, i, sunrises, sunsets) {
  const t = /** @type {string[]} */ (hourly.time)[i];
  const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
  const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
  const feels = /** @type {number[]} */ (hourly.apparent_temperature ?? [])[i];
  const precipPct = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
  const precipIn = /** @type {number[]} */ (hourly.precipitation ?? [])[i];
  const wind = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
  const gust = /** @type {number[]} */ (hourly.wind_gusts_10m ?? [])[i];
  const rh = /** @type {number[]} */ (hourly.relative_humidity_2m ?? [])[i];
  const dew = /** @type {number[]} */ (hourly.dewpoint_2m ?? [])[i];
  const cloud = /** @type {number[]} */ (hourly.cloud_cover ?? [])[i];
  const uv = /** @type {number[]} */ (hourly.uv_index ?? [])[i];
  const vis = /** @type {number[]} */ (hourly.visibility ?? [])[i];
  const day = isDaytime(t, sunrises, sunsets);

  const rows = [
    ['Condition', wmoLabel(code)],
    ['Temperature', temp != null ? `${Math.round(temp)}°F` : null],
    ['Feels like', feels != null ? `${Math.round(feels)}°F` : null],
    ['Precip chance', precipPct != null ? `${precipPct}%` : null],
    ['Precip amount', precipIn != null ? `${Number(precipIn).toFixed(2)} in` : null],
    ['Wind', wind != null ? `${Math.round(wind)} mph` : null],
    ['Wind gust', gust != null ? `${Math.round(gust)} mph` : null],
    ['Humidity', rh != null ? `${rh}%` : null],
    ['Dewpoint', dew != null ? `${Math.round(dew)}°F` : null],
    ['Cloud cover', cloud != null ? `${cloud}%` : null],
    ['Visibility', fmtVisibility(vis)],
    ['UV index', uv != null ? String(uv) : null],
    ['Day / night', day ? 'Day' : 'Night'],
  ].filter(([, v]) => v != null && v !== '');

  return `
    <dl class="hour-detail-grid">
      ${rows.map(([k, v]) => `<div><dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}
    </dl>
  `;
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {(slug: string) => boolean} onFavoriteToggle
 * @param {boolean} [starred]
 */
export function renderDashboard(root, data, onFavoriteToggle, starred = false) {
  root.innerHTML = '';
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
    const windDir = windDirLabel(/** @type {number | null} */ (current.wind_dir_deg ?? null));
    const wind =
      current.wind_speed_mph != null
        ? `${Math.round(Number(current.wind_speed_mph))} mph${current.wind_gust_mph != null ? ` (gust ${Math.round(Number(current.wind_gust_mph))})` : ''}${windDir ? ` · ${windDir}` : ''}`
        : windDir;
    const code = /** @type {number | null} */ (current.weather_code ?? null);
    const precipIn =
      current.precip_in != null ? `${Number(current.precip_in).toFixed(2)} in` : null;
    summarySection.innerHTML = `
      <h2 id="summary-heading">Current conditions</h2>
      <div class="summary-grid">
        <div class="summary-primary">
          ${weatherIconHtml(code, { isDay: nowIsDay, size: 72, className: 'weather-icon weather-icon--lg', alt: String(current.condition ?? wmoLabel(code)) })}
          <p class="summary-temp" aria-label="Temperature">
            ${Math.round(Number(current.temp_f))}°F
          </p>
          <p class="summary-conditions">${escapeHtml(String(current.condition ?? wmoLabel(code)))}</p>
        </div>
        <dl class="summary-details">
          ${detailItem('Feels like', current.feels_like_f != null ? `${Math.round(Number(current.feels_like_f))}°F` : null)}
          ${detailItem('Humidity', current.humidity != null ? `${current.humidity}%` : null)}
          ${detailItem('Wind', wind)}
          ${detailItem('Precip (hour)', precipIn)}
          ${detailItem('Pressure', current.pressure_mb != null ? `${Math.round(Number(current.pressure_mb))} mb` : null)}
          ${detailItem('Cloud cover', current.cloud_cover != null ? `${current.cloud_cover}%` : null)}
          ${detailItem('UV index', current.uv_index != null ? String(current.uv_index) : null)}
        </dl>
      </div>
      <p class="section-cta">
        ${sourceLink(links.nws_forecast ?? '', 'NWS point forecast', 'btn btn-secondary btn-sm')}
      </p>
      ${data.updatedAt ? `<p class="updated-at">Location data updated ${fmtDateTime(String(data.updatedAt))}</p>` : ''}
    `;
  }
  root.appendChild(summarySection);

  renderImagerySection(root, {
    lat: /** @type {number | null} */ (data.lat ?? null),
    lon: /** @type {number | null} */ (data.lon ?? null),
    name: String(data.name ?? slug),
    links,
  });

  const sections = document.createElement('div');
  sections.className = 'dashboard-sections';

  renderCollapsibleSection(sections, 'hourly-heading', 'Hourly forecast (48h)', () => {
    const hourly = /** @type {Record<string, unknown>} */ (data.hourly ?? null);
    if (!hourly?.time || !Array.isArray(hourly.time) || hourly.time.length === 0) {
      const frag = document.createDocumentFragment();
      renderEmpty(
        frag,
        'No hourly data',
        data.forecastStale
          ? 'Prior forecast also lacked hourly rows.'
          : 'Forecast temporarily unavailable (source rate-limited or failed this run).',
      );
      return frag;
    }

    const list = document.createElement('div');
    list.className = 'hour-list';
    list.setAttribute('role', 'list');

    const times = /** @type {string[]} */ (hourly.time).slice(0, 48);
    times.forEach((t, i) => {
      const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
      const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
      const precipPct = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
      const precipIn = /** @type {number[]} */ (hourly.precipitation ?? [])[i];
      const windSpd = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
      const gust = /** @type {number[]} */ (hourly.wind_gusts_10m ?? [])[i];
      const day = isDaytime(t, sunrises, sunsets);

      const details = document.createElement('details');
      details.className = 'hour-row';
      details.setAttribute('role', 'listitem');
      const summary = document.createElement('summary');
      summary.className = 'hour-summary';
      summary.innerHTML = `
        <span class="hour-time">${escapeHtml(fmtTime(t))}</span>
        <span class="hour-cond cond-cell">${weatherIconHtml(code, { isDay: day, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></span>
        <span class="hour-temp">${temp != null ? `${Math.round(temp)}°F` : '—'}</span>
        <span class="hour-precip">${precipPct != null ? `${precipPct}%` : '—'}${precipIn != null ? ` · ${Number(precipIn).toFixed(2)}"` : ''}</span>
        <span class="hour-wind">${windSpd != null ? `${Math.round(windSpd)} mph` : '—'}${gust != null ? ` G${Math.round(gust)}` : ''}</span>
        <span class="hour-more" aria-hidden="true">Details</span>
      `;
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'hour-body';
      body.innerHTML = renderHourDetails(hourly, i, sunrises, sunsets);
      details.appendChild(body);
      list.appendChild(details);
    });

    const hint = document.createElement('p');
    hint.className = 'table-hint';
    hint.textContent =
      'Expand any hour for humidity, dewpoint, cloud cover, UV, visibility, and more.';
    const wrap = document.createDocumentFragment();
    wrap.appendChild(hint);
    wrap.appendChild(list);
    return wrap;
  });

  renderCollapsibleSection(sections, 'daily-heading', 'Daily forecast (10 day)', () => {
    const times = /** @type {string[]} */ (daily?.time ?? []);
    if (!times.length) {
      const frag = document.createDocumentFragment();
      renderEmpty(
        frag,
        'No daily forecast',
        'Forecast temporarily unavailable (source rate-limited or failed this run).',
      );
      return frag;
    }

    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    const table = document.createElement('table');
    table.className = 'data-table data-table--dense';
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
      const gustMax = /** @type {number[]} */ (daily.wind_gusts_10m_max ?? [])[i];
      const uvMax = /** @type {number[]} */ (daily.uv_index_max ?? [])[i];
      const code = /** @type {number[]} */ (daily.weather_code ?? [])[i];
      const rise = /** @type {string[]} */ (daily.sunrise ?? [])[i];
      const set = /** @type {string[]} */ (daily.sunset ?? [])[i];
      tr.innerHTML = `
        <td>${fmtDate(times[i])}</td>
        <td class="cond-cell">${weatherIconHtml(code, { isDay: true, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>
        <td>${hi != null ? `${Math.round(hi)}°F` : '—'}</td>
        <td>${lo != null ? `${Math.round(lo)}°F` : '—'}</td>
        <td>${precipPct != null ? `${precipPct}%` : '—'}</td>
        <td>${precipSum != null ? `${Number(precipSum).toFixed(2)}` : '—'}</td>
        <td>${windMax != null ? `${Math.round(windMax)} mph` : '—'}</td>
        <td>${gustMax != null ? `${Math.round(gustMax)} mph` : '—'}</td>
        <td>${uvMax != null ? String(uvMax) : '—'}</td>
        <td>${fmtClock(rise)}</td>
        <td>${fmtClock(set)}</td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  });

  renderCollapsibleSection(sections, 'alerts-heading', 'Alerts & discussion', () => {
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
        const details = document.createElement('details');
        details.className = 'alert-item';
        details.open = alerts.length <= 2;
        const sev = a.severity ? String(a.severity) : 'Unknown';
        const summary = document.createElement('summary');
        summary.innerHTML = `
          <strong>${escapeHtml(String(a.event ?? a.headline ?? 'Alert'))}</strong>
          <span class="alert-severity alert-severity--${escapeHtml(sev.toLowerCase())}">${escapeHtml(sev)}</span>
          ${a.ends ? `<span class="alert-ends">Until ${escapeHtml(fmtDateTime(String(a.ends)))}</span>` : ''}
        `;
        details.appendChild(summary);
        const body = document.createElement('div');
        body.className = 'alert-body';
        const parts = [];
        if (a.areaDesc)
          parts.push(`<p><strong>Area:</strong> ${escapeHtml(String(a.areaDesc))}</p>`);
        if (a.headline) parts.push(`<p>${escapeHtml(String(a.headline))}</p>`);
        if (a.description) {
          parts.push(`<pre class="alert-description">${escapeHtml(String(a.description))}</pre>`);
        }
        if (a.url) {
          parts.push(
            `<p>${sourceLink(String(a.url), 'Full NWS alert', 'btn btn-secondary btn-sm')}</p>`,
          );
        }
        body.innerHTML = parts.join('') || '<p>No additional detail.</p>';
        details.appendChild(body);
        li.appendChild(details);
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
  });

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
    data.coagmet?.url || links.coagmet
      ? sourceLink(
          String(data.coagmet?.url || links.coagmet),
          'Station',
          'btn btn-secondary btn-sm',
        )
      : '',
  );

  renderCollapsibleSection(sections, 'metar-heading', 'Aviation (METAR / TAF)', () => {
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
      p.innerHTML = sourceLink(String(url), 'Aviation Weather Center', 'btn btn-secondary btn-sm');
      wrap.appendChild(p);
    }
    return wrap;
  });

  renderCollapsibleSection(sections, 'aqi-heading', 'Air quality', () => {
    const an = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
    const pa = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
    const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
    if (!an && !pa && !omaq) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No air quality data', 'No AirNow, PurpleAir, or model AQ reading nearby.');
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
      parts.push(`<dt>PurpleAir PM2.5</dt><dd>${pa.pm25 != null ? `${pa.pm25} µg/m³` : '—'}</dd>`);
      parts.push(`<dt>PurpleAir AQI (est.)</dt><dd>${pa.aqi_pm25 ?? '—'}</dd>`);
      if (pa.humidity != null) parts.push(`<dt>PurpleAir humidity</dt><dd>${pa.humidity}%</dd>`);
      if (pa.temperature_f != null) {
        parts.push(`<dt>PurpleAir temp</dt><dd>${pa.temperature_f}°F</dd>`);
      }
    }
    if (omaq) {
      parts.push(`<dt>Model PM2.5</dt><dd>${omaq.pm25 != null ? `${omaq.pm25} µg/m³` : '—'}</dd>`);
      parts.push(
        `<dt>Model US AQI</dt><dd>${omaq.us_aqi != null ? String(omaq.us_aqi) : '—'}</dd>`,
      );
      parts.push(
        `<dt>Model European AQI</dt><dd>${omaq.european_aqi != null ? String(omaq.european_aqi) : '—'}</dd>`,
      );
      if (omaq.time) {
        parts.push(`<dt>Model AQ time</dt><dd>${escapeHtml(fmtDateTime(String(omaq.time)))}</dd>`);
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
  });

  renderCollapsibleSection(sections, 'links-heading', 'More sources', () => {
    const entries = [
      ['NWS point forecast', links.nws_forecast],
      ['Personal weather station', links.pws],
      ['PurpleAir map', links.purpleair_map],
      ['AirNow', links.airnow],
      ['CoAgMET', links.coagmet],
      ['Aviation Weather', links.aviation],
      ['RainViewer radar', links.rainviewer],
    ].filter(([, url]) => Boolean(url));
    if (!entries.length) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No links', '');
      return frag;
    }
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
    return ul;
  });

  root.appendChild(sections);

  const favBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#btn-favorite'));
  favBtn?.addEventListener('click', () => {
    const next = onFavoriteToggle(slug);
    favBtn.setAttribute('aria-pressed', String(next));
    favBtn.setAttribute('aria-label', next ? 'Remove from favorites' : 'Add to favorites');
    const span = favBtn.querySelector('span');
    if (span) span.textContent = next ? '★' : '☆';
  });
}
