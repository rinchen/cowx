import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';

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
 * @param {string} label
 * @param {string | null | undefined} value
 */
function detailItem(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/**
 * @param {HTMLElement} parent
 * @param {string} headingId
 * @param {string} title
 * @param {() => (Node | null)} renderBody
 */
function renderCollapsibleSection(parent, headingId, title, renderBody) {
  const body = renderBody();
  if (body == null) return;

  const details = document.createElement('details');
  details.className = 'dash-section';
  details.open = true;
  const summary = document.createElement('summary');
  summary.id = headingId;
  summary.textContent = title;
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
    const wind =
      current.wind_speed_mph != null
        ? `${Math.round(Number(current.wind_speed_mph))} mph${current.wind_gust_mph != null ? ` (gust ${Math.round(Number(current.wind_gust_mph))})` : ''}`
        : null;
    const code = /** @type {number | null} */ (current.weather_code ?? null);
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
          ${detailItem('Pressure', current.pressure_mb != null ? `${Math.round(Number(current.pressure_mb))} mb` : null)}
          ${detailItem('Cloud cover', current.cloud_cover != null ? `${current.cloud_cover}%` : null)}
          ${detailItem('UV index', current.uv_index != null ? String(current.uv_index) : null)}
        </dl>
      </div>
      ${data.updatedAt ? `<p class="updated-at">Location data updated ${fmtDateTime(String(data.updatedAt))}</p>` : ''}
    `;
  }
  root.appendChild(summarySection);

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
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <caption class="sr-only">Hourly forecast</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Cond.</th><th scope="col">Temp</th><th scope="col">Precip</th><th scope="col">Wind</th></tr></thead>
    `;
    const tbody = document.createElement('tbody');
    const times = /** @type {string[]} */ (hourly.time).slice(0, 48);
    times.forEach((t, i) => {
      const tr = document.createElement('tr');
      const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
      const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
      const precip = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
      const windSpd = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
      const day = isDaytime(t, sunrises, sunsets);
      tr.innerHTML = `
        <td>${fmtTime(t)}</td>
        <td class="cond-cell">${weatherIconHtml(code, { isDay: day, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>
        <td>${temp != null ? `${Math.round(temp)}°F` : '—'}</td>
        <td>${precip != null ? `${precip}%` : '—'}</td>
        <td>${windSpd != null ? `${Math.round(windSpd)} mph` : '—'}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  });

  renderCollapsibleSection(sections, 'daily-heading', 'Daily forecast', () => {
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

    const wrap = document.createDocumentFragment();
    const makeTable = (start, end, caption) => {
      const h3 = document.createElement('h3');
      h3.textContent = caption;
      wrap.appendChild(h3);
      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = `<thead><tr><th scope="col">Day</th><th scope="col">Cond.</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Precip</th><th scope="col">Wind</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      for (let i = start; i < Math.min(end, times.length); i += 1) {
        const tr = document.createElement('tr');
        const hi = /** @type {number[]} */ (daily.temperature_2m_max ?? [])[i];
        const lo = /** @type {number[]} */ (daily.temperature_2m_min ?? [])[i];
        const precip = /** @type {number[]} */ (daily.precipitation_probability_max ?? [])[i];
        const windMax = /** @type {number[]} */ (daily.wind_speed_10m_max ?? [])[i];
        const code = /** @type {number[]} */ (daily.weather_code ?? [])[i];
        tr.innerHTML = `
          <td>${fmtDate(times[i])}</td>
          <td class="cond-cell">${weatherIconHtml(code, { isDay: true, size: 28, className: 'weather-icon weather-icon--sm', alt: wmoLabel(code) })} <span>${escapeHtml(wmoLabel(code))}</span></td>
          <td>${hi != null ? `${Math.round(hi)}°F` : '—'}</td>
          <td>${lo != null ? `${Math.round(lo)}°F` : '—'}</td>
          <td>${precip != null ? `${precip}%` : '—'}</td>
          <td>${windMax != null ? `${Math.round(windMax)} mph` : '—'}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
    };
    makeTable(0, 3, '3-day outlook');
    makeTable(0, 10, '10-day outlook');
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
      ul.className = 'alert-list';
      alerts.forEach((a) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${escapeHtml(String(a.event ?? a.headline ?? 'Alert'))}</strong>
          <p>${escapeHtml(String(a.headline ?? a.description ?? '').slice(0, 280))}</p>`;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    if (afd?.snippet) {
      const p = document.createElement('p');
      p.className = 'afd-snippet';
      p.innerHTML = `<strong>NWS ${escapeHtml(String(afd.office ?? ''))} discussion:</strong> ${escapeHtml(String(afd.snippet))}`;
      wrap.appendChild(p);
      if (afd.url) {
        const a = document.createElement('a');
        a.href = String(afd.url);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Full Area Forecast Discussion';
        wrap.appendChild(a);
      }
    }
    return wrap;
  });

  renderCollapsibleSection(sections, 'coagmet-heading', 'Agriculture (CoAgMET)', () => {
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
    const rows = [
      ['Station', `${coag.station_name ?? coag.station_id} (${coag.distance_km} km)`],
      ['Soil 5 cm', coag.soil_temp_5cm_f != null ? `${coag.soil_temp_5cm_f}°F` : null],
      ['Soil 15 cm', coag.soil_temp_15cm_f != null ? `${coag.soil_temp_15cm_f}°F` : null],
      ['ET₀', coag.eto_in != null ? String(coag.eto_in) : null],
      ['Vapor pressure', coag.vapor_pressure != null ? String(coag.vapor_pressure) : null],
      ['Solar', coag.solar_radiation != null ? String(coag.solar_radiation) : null],
      ['Air temp', coag.air_temp_f != null ? `${coag.air_temp_f}°F` : null],
      ['Humidity', coag.relative_humidity != null ? `${coag.relative_humidity}%` : null],
    ].filter(([, v]) => v != null && v !== '');

    const dl = document.createElement('dl');
    dl.className = 'metric-list';
    dl.innerHTML = rows
      .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
      .join('');
    return dl;
  });

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
    const meta = document.createElement('p');
    meta.className = 'section-meta';
    meta.textContent = `${av.icao ?? ''} · ${av.flight_category ?? '—'} · ${av.temp_f != null ? `${av.temp_f}°F` : ''}`;
    wrap.appendChild(meta);
    const pre = document.createElement('pre');
    pre.className = 'metar-raw';
    pre.textContent = String(av.raw_metar);
    wrap.appendChild(pre);
    if (av.raw_taf) {
      const taf = document.createElement('pre');
      taf.className = 'metar-raw';
      taf.textContent = String(av.raw_taf);
      wrap.appendChild(taf);
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
    const dl = document.createElement('dl');
    dl.className = 'metric-list';
    const parts = [];
    if (an) {
      parts.push(
        `<dt>AirNow AQI</dt><dd>${an.aqi ?? '—'} ${an.category ? `(${escapeHtml(String(an.category))})` : ''}</dd>`,
      );
      parts.push(
        `<dt>Parameter</dt><dd>${an.parameter ? escapeHtml(String(an.parameter)) : '—'}</dd>`,
      );
    }
    if (pa) {
      parts.push(
        `<dt>PurpleAir</dt><dd>${pa.name ? escapeHtml(String(pa.name)) : '—'}${pa.distance_km != null ? ` (${pa.distance_km} km)` : ''}</dd>`,
      );
      parts.push(`<dt>PurpleAir PM2.5</dt><dd>${pa.pm25 != null ? `${pa.pm25} µg/m³` : '—'}</dd>`);
      parts.push(`<dt>PurpleAir AQI (est.)</dt><dd>${pa.aqi_pm25 ?? '—'}</dd>`);
    }
    if (omaq) {
      parts.push(`<dt>Model PM2.5</dt><dd>${omaq.pm25 != null ? `${omaq.pm25} µg/m³` : '—'}</dd>`);
      parts.push(
        `<dt>Model European AQI</dt><dd>${omaq.european_aqi != null ? String(omaq.european_aqi) : '—'}</dd>`,
      );
    }
    dl.innerHTML = parts.join('');
    return dl;
  });

  renderCollapsibleSection(sections, 'links-heading', 'Offsite links', () => {
    const links = /** @type {Record<string, string | null>} */ (data.links ?? {});
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
