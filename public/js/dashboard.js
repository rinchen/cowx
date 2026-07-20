const PERSONAS = [
  { id: 'all', label: 'All' },
  { id: 'citizen', label: 'Citizen' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'farmer', label: 'Farmer' },
  { id: 'firefighter', label: 'Firefighter' },
];

/** @type {Record<string, string[]>} */
const SECTION_PERSONAS = {
  hourly: ['all', 'citizen', 'pilot', 'firefighter'],
  daily: ['all', 'citizen', 'farmer', 'firefighter'],
  alerts: ['all', 'citizen', 'pilot', 'farmer', 'firefighter'],
  coagmet: ['all', 'farmer'],
  aviation: ['all', 'pilot'],
  air: ['all', 'citizen', 'firefighter'],
  links: ['all', 'citizen', 'pilot', 'farmer', 'firefighter'],
};

/**
 * @param {string | undefined} persona
 * @param {string[]} allowed
 */
function matchesPersona(persona, allowed) {
  if (!persona || persona === 'all') return true;
  return allowed.includes(persona);
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
 * @param {number|null|undefined} code
 */
function wmoLabel(code) {
  const map = {
    0: 'Clear',
    1: 'Mostly Clear',
    2: 'Partly Cloudy',
    3: 'Overcast',
    45: 'Fog',
    61: 'Rain',
    71: 'Snow',
    95: 'Thunderstorm',
  };
  if (code == null) return '—';
  return map[code] ?? `Code ${code}`;
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
 * @param {string} persona
 * @param {(slug: string) => boolean} onFavoriteToggle
 * @param {boolean} [starred]
 */
export function renderDashboard(root, data, persona, onFavoriteToggle, starred = false) {
  root.innerHTML = '';
  const slug = String(data.slug ?? '');
  const current = /** @type {Record<string, unknown>} */ (data.current ?? {});

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

  const summarySection = document.createElement('section');
  summarySection.className = 'summary-card';
  summarySection.setAttribute('aria-labelledby', 'summary-heading');
  const wind =
    current.wind_speed_mph != null
      ? `${Math.round(Number(current.wind_speed_mph))} mph${current.wind_gust_mph != null ? ` (gust ${Math.round(Number(current.wind_gust_mph))})` : ''}`
      : null;
  summarySection.innerHTML = `
    <h2 id="summary-heading">Current conditions</h2>
    <div class="summary-grid">
      <div class="summary-primary">
        <p class="summary-temp" aria-label="Temperature">
          ${current.temp_f != null ? `${Math.round(Number(current.temp_f))}°F` : '—'}
        </p>
        <p class="summary-conditions">${escapeHtml(String(current.condition ?? 'Unknown'))}</p>
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
  root.appendChild(summarySection);

  const filters = document.createElement('div');
  filters.className = 'persona-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filter by persona');
  PERSONAS.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'persona-btn';
    btn.dataset.persona = p.id;
    btn.textContent = p.label;
    btn.setAttribute('aria-pressed', String(p.id === persona));
    if (p.id === persona) btn.classList.add('is-active');
    filters.appendChild(btn);
  });
  root.appendChild(filters);

  const sections = document.createElement('div');
  sections.className = 'dashboard-sections';

  renderCollapsibleSection(sections, 'hourly-heading', 'Hourly forecast (72h)', () => {
    if (!matchesPersona(persona, SECTION_PERSONAS.hourly)) return null;
    const hourly = /** @type {Record<string, unknown>} */ (data.hourly ?? null);
    if (!hourly?.time || !Array.isArray(hourly.time) || hourly.time.length === 0) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No hourly data', 'Check back after the next fetch cycle.');
      return frag;
    }
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <caption class="sr-only">Hourly forecast</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Temp</th><th scope="col">Conditions</th><th scope="col">Precip</th><th scope="col">Wind</th></tr></thead>
    `;
    const tbody = document.createElement('tbody');
    const times = /** @type {string[]} */ (hourly.time).slice(0, 48);
    times.forEach((t, i) => {
      const tr = document.createElement('tr');
      const temp = /** @type {number[]} */ (hourly.temperature_2m ?? [])[i];
      const code = /** @type {number[]} */ (hourly.weather_code ?? [])[i];
      const precip = /** @type {number[]} */ (hourly.precipitation_probability ?? [])[i];
      const windSpd = /** @type {number[]} */ (hourly.wind_speed_10m ?? [])[i];
      tr.innerHTML = `
        <td>${fmtTime(t)}</td>
        <td>${temp != null ? `${Math.round(temp)}°F` : '—'}</td>
        <td>${escapeHtml(wmoLabel(code))}</td>
        <td>${precip != null ? `${precip}%` : '—'}</td>
        <td>${windSpd != null ? `${Math.round(windSpd)} mph` : '—'}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  });

  renderCollapsibleSection(sections, 'daily-heading', 'Daily forecast', () => {
    if (!matchesPersona(persona, SECTION_PERSONAS.daily)) return null;
    const daily = /** @type {Record<string, unknown>} */ (data.daily ?? null);
    const times = /** @type {string[]} */ (daily?.time ?? []);
    if (!times.length) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No daily forecast', 'Daily outlook is not available yet.');
      return frag;
    }

    const wrap = document.createDocumentFragment();
    const makeTable = (start, end, caption) => {
      const h3 = document.createElement('h3');
      h3.textContent = caption;
      wrap.appendChild(h3);
      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = `<thead><tr><th scope="col">Day</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Precip</th><th scope="col">Wind</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      for (let i = start; i < Math.min(end, times.length); i += 1) {
        const tr = document.createElement('tr');
        const hi = /** @type {number[]} */ (daily.temperature_2m_max ?? [])[i];
        const lo = /** @type {number[]} */ (daily.temperature_2m_min ?? [])[i];
        const precip = /** @type {number[]} */ (daily.precipitation_probability_max ?? [])[i];
        const windMax = /** @type {number[]} */ (daily.wind_speed_10m_max ?? [])[i];
        tr.innerHTML = `
          <td>${fmtDate(times[i])}</td>
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
    if (!matchesPersona(persona, SECTION_PERSONAS.alerts)) return null;
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
    if (!matchesPersona(persona, SECTION_PERSONAS.coagmet)) return null;
    const coag = /** @type {Record<string, unknown> | null} */ (data.coagmet ?? null);
    if (!coag) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No CoAgMET data', 'No nearby agricultural station within range.');
      return frag;
    }
    const dl = document.createElement('dl');
    dl.className = 'metric-list';
    dl.innerHTML = `
      <dt>Station</dt><dd>${escapeHtml(String(coag.station_name ?? coag.station_id))} (${coag.distance_km} km)</dd>
      <dt>Soil 5 cm</dt><dd>${coag.soil_temp_5cm_f != null ? `${coag.soil_temp_5cm_f}°F` : '—'}</dd>
      <dt>Soil 15 cm</dt><dd>${coag.soil_temp_15cm_f != null ? `${coag.soil_temp_15cm_f}°F` : '—'}</dd>
      <dt>ET₀</dt><dd>${coag.eto_in != null ? `${coag.eto_in}` : '—'}</dd>
      <dt>Vapor pressure</dt><dd>${coag.vapor_pressure != null ? String(coag.vapor_pressure) : '—'}</dd>
      <dt>Solar</dt><dd>${coag.solar_radiation != null ? String(coag.solar_radiation) : '—'}</dd>
    `;
    return dl;
  });

  renderCollapsibleSection(sections, 'metar-heading', 'Aviation (METAR / TAF)', () => {
    if (!matchesPersona(persona, SECTION_PERSONAS.aviation)) return null;
    const av = /** @type {Record<string, unknown> | null} */ (data.aviation ?? null);
    if (!av?.raw_metar) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No METAR', 'Aviation observation not available nearby.');
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
    if (!matchesPersona(persona, SECTION_PERSONAS.air)) return null;
    const an = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
    const pa = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
    if (!an && !pa) {
      const frag = document.createDocumentFragment();
      renderEmpty(frag, 'No air quality data', 'AQI and sensor readings are unavailable.');
      return frag;
    }
    const dl = document.createElement('dl');
    dl.className = 'metric-list';
    dl.innerHTML = `
      <dt>AirNow AQI</dt><dd>${an?.aqi ?? '—'} ${an?.category ? `(${escapeHtml(String(an.category))})` : ''}</dd>
      <dt>Parameter</dt><dd>${an?.parameter ? escapeHtml(String(an.parameter)) : '—'}</dd>
      <dt>PurpleAir</dt><dd>${pa?.name ? escapeHtml(String(pa.name)) : '—'}${pa?.distance_km != null ? ` (${pa.distance_km} km)` : ''}</dd>
      <dt>PurpleAir PM2.5</dt><dd>${pa?.pm25 != null ? `${pa.pm25} µg/m³` : '—'}</dd>
      <dt>PurpleAir AQI (est.)</dt><dd>${pa?.aqi_pm25 ?? '—'}</dd>
    `;
    return dl;
  });

  renderCollapsibleSection(sections, 'links-heading', 'Offsite links', () => {
    if (!matchesPersona(persona, SECTION_PERSONAS.links)) return null;
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

  filters.querySelectorAll('.persona-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = /** @type {HTMLElement} */ (btn).dataset.persona ?? 'all';
      root.dispatchEvent(
        new CustomEvent('persona-change', { detail: { persona: next }, bubbles: true }),
      );
    });
  });
}
