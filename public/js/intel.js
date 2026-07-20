/**
 * Glass intel column for the locality workspace.
 */

import { synthesizeBottomLine } from './bottom-line.js';
import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import { estimateRfComms } from './rf-comms.js';
import { detectPressureDip, mbToInHg, meteogramHtml, miniBarChartHtml } from './sparkline.js';
import { windCompassHtml, windDirLabel } from './wind.js';

/**
 * @param {unknown} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {number | null} aqi
 * @returns {{ label: string, className: string }}
 */
export function aqiCategory(aqi) {
  if (aqi == null || !Number.isFinite(aqi))
    return { label: 'Unavailable', className: 'aqi-ring--na' };
  if (aqi <= 50) return { label: 'Good', className: 'aqi-ring--good' };
  if (aqi <= 100) return { label: 'Moderate', className: 'aqi-ring--moderate' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', className: 'aqi-ring--usg' };
  if (aqi <= 200) return { label: 'Unhealthy', className: 'aqi-ring--unhealthy' };
  if (aqi <= 300) return { label: 'Very unhealthy', className: 'aqi-ring--very' };
  return { label: 'Hazardous', className: 'aqi-ring--hazardous' };
}

/**
 * @param {Record<string, unknown>} data
 * @returns {{ aqi: number | null, pm25: number | null, source: string }}
 */
function pickAqi(data) {
  const airnow = /** @type {Record<string, unknown> | null} */ (data.airnow ?? null);
  const purpleair = /** @type {Record<string, unknown> | null} */ (data.purpleair ?? null);
  const omaq = /** @type {Record<string, unknown> | null} */ (data.openmeteo_aq ?? null);
  if (airnow?.aqi != null) {
    return {
      aqi: Number(airnow.aqi),
      pm25: null,
      source: 'AirNow',
    };
  }
  if (purpleair?.aqi_pm25 != null) {
    return {
      aqi: Number(purpleair.aqi_pm25),
      pm25: purpleair.pm25 != null ? Number(purpleair.pm25) : null,
      source: 'PurpleAir',
    };
  }
  if (omaq?.us_aqi != null) {
    return {
      aqi: Number(omaq.us_aqi),
      pm25: omaq.pm25 != null ? Number(omaq.pm25) : null,
      source: 'Open-Meteo',
    };
  }
  return { aqi: null, pm25: null, source: '' };
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
    const d = Math.abs(new Date(t).getTime() - now);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

/**
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{ onJump?: (id: string) => void }} [options]
 * @returns {{ headline: string }}
 */
export function renderIntel(root, data, options = {}) {
  const current = /** @type {Record<string, unknown> | null} */ (data.current ?? null);
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const { headline, priority } = synthesizeBottomLine(data);
  const aq = pickAqi(data);
  const cat = aqiCategory(aq.aqi);

  const times = /** @type {string[]} */ (hourly?.time ?? []);
  const hi = times.length ? nearestHourIndex(times) : 0;
  const sliceEnd = Math.min(times.length, hi + 24);
  const sliceStart = Math.max(0, sliceEnd - 24);

  const temps = /** @type {number[]} */ (hourly?.temperature_2m ?? []).slice(sliceStart, sliceEnd);
  const winds = /** @type {number[]} */ (hourly?.wind_speed_10m ?? []).slice(sliceStart, sliceEnd);
  const gusts = /** @type {number[]} */ (hourly?.wind_gusts_10m ?? []).slice(sliceStart, sliceEnd);
  const pressureMb = /** @type {number[]} */ (hourly?.pressure_msl ?? []).slice(
    sliceStart,
    sliceEnd,
  );
  const pressureIn = pressureMb.map((v) =>
    Number.isFinite(Number(v)) ? mbToInHg(Number(v)) : NaN,
  );
  const dip = detectPressureDip(pressureIn.filter((v) => Number.isFinite(v)));

  const sunrises = /** @type {string[]} */ (daily?.sunrise ?? []);
  const sunsets = /** @type {string[]} */ (daily?.sunset ?? []);
  const isDay =
    current?.is_day === 0 || current?.is_day === 1
      ? current.is_day === 1
      : isDaytime(new Date().toISOString(), sunrises, sunsets);
  const code = /** @type {number | null} */ (current?.weather_code ?? null);

  const windDeg = /** @type {number | null} */ (current?.wind_dir_deg ?? null);
  const compass = windCompassHtml(windDeg, { size: 36 });

  const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
  const cam = /** @type {Record<string, unknown> | null} */ (data.cdot_camera ?? null);
  const rwis = /** @type {Record<string, unknown> | null} */ (data.cdot_rwis ?? null);
  const cwop = /** @type {Record<string, unknown> | null} */ (data.cwop ?? null);
  const coag = /** @type {Record<string, unknown> | null} */ (data.coagmet ?? null);

  let rf = /** @type {Record<string, unknown> | null} */ (data.rf_comms ?? null);
  if (!rf && current && hourly) {
    const series = /** @type {number[]} */ (hourly.temperature_850hPa ?? []);
    const t850 = series.length ? series[hi] : null;
    rf = estimateRfComms(
      current,
      t850,
      data.elevation_ft != null ? Number(data.elevation_ft) : null,
    );
  }

  const rfClass =
    rf?.status === 'ducting_likely'
      ? 'rf-badge--ducting'
      : rf?.status === 'poor'
        ? 'rf-badge--poor'
        : 'rf-badge--nominal';
  const rfLabel =
    rf?.status === 'ducting_likely'
      ? 'Ducting likely'
      : rf?.status === 'poor'
        ? 'Poor'
        : rf
          ? 'Nominal'
          : null;

  const probs = /** @type {number[]} */ (hourly?.precipitation_probability ?? []).slice(
    hi,
    hi + 12,
  );

  root.innerHTML = `
    <section class="glass-panel glass-panel--headline" aria-labelledby="bottom-line-heading">
      <h2 id="bottom-line-heading" class="sr-only">Bottom line</h2>
      <p class="bottom-line bottom-line--${escapeHtml(priority)}" role="status">${escapeHtml(headline)}</p>
    </section>

    <section class="glass-panel" aria-labelledby="intel-now-heading">
      <div class="intel-now">
        <div class="intel-now__primary">
          <h2 id="intel-now-heading" class="glass-panel__title">Now</h2>
          ${
            current?.temp_f != null
              ? `${weatherIconHtml(code, { isDay, size: 56, className: 'weather-icon weather-icon--lg', alt: String(current.condition ?? wmoLabel(code)) })}
                 <p class="intel-temp">${Math.round(Number(current.temp_f))}°F</p>
                 <p class="intel-cond">${escapeHtml(String(current.condition ?? wmoLabel(code)))}</p>`
              : `<p class="empty-state">Current conditions unavailable.</p>`
          }
          ${
            current?.wind_speed_mph != null
              ? `<p class="intel-wind">${compass ? compass : ''} ${Math.round(Number(current.wind_speed_mph))} mph${current.wind_gust_mph != null ? ` · gusts ${Math.round(Number(current.wind_gust_mph))}` : ''}${windDirLabel(windDeg) ? ` from ${escapeHtml(windDirLabel(windDeg) ?? '')}` : ''}</p>`
              : ''
          }
        </div>
        <div class="aqi-ring ${cat.className}" role="img" aria-label="Air quality ${aq.aqi != null ? Math.round(aq.aqi) : 'unavailable'}: ${cat.label}${aq.source ? ` from ${aq.source}` : ''}">
          <span class="aqi-ring__value">${aq.aqi != null ? Math.round(aq.aqi) : '—'}</span>
          <span class="aqi-ring__label">AQI</span>
          <span class="aqi-ring__cat">${escapeHtml(cat.label)}</span>
        </div>
      </div>
    </section>

    <section class="glass-panel" aria-labelledby="meteogram-heading">
      <h2 id="meteogram-heading" class="glass-panel__title">Next 24 hours</h2>
      <div class="meteogram-stack">
        <div class="meteogram-row">
          <span class="meteogram-row__label">Temp °F</span>
          ${meteogramHtml(temps, { color: '#7dd3fc', label: 'Temperature trend Fahrenheit', fill: true }) || '<p class="empty-state">No temperature series</p>'}
        </div>
        <div class="meteogram-row">
          <span class="meteogram-row__label">Pressure inHg${dip.dip ? ' · front dip' : ''}</span>
          ${
            meteogramHtml(
              pressureIn.filter((v) => Number.isFinite(v)),
              {
                color: dip.dip ? '#fbbf24' : '#a5b4fc',
                label: dip.dip
                  ? `Pressure trend with rapid dip of ${dip.delta.toFixed(2)} inches`
                  : 'Barometric pressure trend inches of mercury',
                highlightFrom: dip.dip ? dip.index : undefined,
                fill: true,
              },
            ) || '<p class="empty-state">No pressure series</p>'
          }
        </div>
        <div class="meteogram-row">
          <span class="meteogram-row__label">Wind / gust mph</span>
          ${
            meteogramHtml(winds, {
              color: '#86efac',
              secondary: gusts,
              secondaryColor: '#fb923c',
              label: 'Wind speed and gusts miles per hour',
              fill: false,
            }) || '<p class="empty-state">No wind series</p>'
          }
        </div>
        <div class="meteogram-row">
          <span class="meteogram-row__label">Precip chance</span>
          ${miniBarChartHtml(probs, { width: 220, height: 36, color: '#38bdf8' }) || '<p class="empty-state">No precip probability</p>'}
        </div>
      </div>
    </section>

    <section class="glass-panel" aria-labelledby="intel-alerts-heading">
      <h2 id="intel-alerts-heading" class="glass-panel__title">Alerts</h2>
      ${
        alerts.length
          ? `<ul class="intel-alert-list">${alerts
              .slice(0, 4)
              .map((a) => {
                const sev = String(a.severity ?? 'Unknown');
                return `<li><button type="button" class="intel-jump" data-jump-to="alerts-heading"><strong>${escapeHtml(String(a.event ?? 'Alert'))}</strong> <span class="alert-severity alert-severity--${escapeHtml(sev.toLowerCase())}">${escapeHtml(sev)}</span></button></li>`;
              })
              .join('')}</ul>
             <button type="button" class="btn btn-link intel-jump" data-jump-to="alerts-heading">Full alert text</button>`
          : `<p class="intel-muted">No active NWS alerts for this area.</p>`
      }
    </section>

    ${
      cam?.imageUrl || cam?.pageUrl
        ? `<section class="glass-panel" aria-labelledby="cam-heading" id="cdot-camera-panel">
            <h2 id="cam-heading" class="glass-panel__title">CDOT camera</h2>
            <p class="intel-muted">${escapeHtml(String(cam.name ?? 'Nearby camera'))}${cam.distance_km != null ? ` · ${cam.distance_km} km` : ''}</p>
            ${
              cam.imageUrl
                ? `<img class="cdot-cam" src="${escapeHtml(String(cam.imageUrl))}?t=${Date.now()}" alt="CDOT traffic camera: ${escapeHtml(String(cam.name ?? 'Colorado roadway'))}" loading="lazy" decoding="async" data-cdot-cam />`
                : ''
            }
            ${cam.pageUrl ? `<p><a class="btn btn-secondary btn-sm" href="${escapeHtml(String(cam.pageUrl))}" target="_blank" rel="noopener noreferrer">Open on COtrip</a></p>` : ''}
            ${
              rwis
                ? `<dl class="metric-list metric-list--compact">
                    <dt>Nearest RWIS</dt><dd>${escapeHtml(String(rwis.name ?? ''))}${rwis.distance_km != null ? ` (${rwis.distance_km} km)` : ''}</dd>
                    ${rwis.air_temp_f != null ? `<dt>Air</dt><dd>${Math.round(Number(rwis.air_temp_f))}°F</dd>` : ''}
                    ${rwis.surface_temp_f != null ? `<dt>Pavement</dt><dd>${Math.round(Number(rwis.surface_temp_f))}°F${rwis.surface_status ? ` · ${escapeHtml(String(rwis.surface_status))}` : ''}</dd>` : ''}
                    ${rwis.wind_speed_mph != null ? `<dt>Wind</dt><dd>${Math.round(Number(rwis.wind_speed_mph))} mph</dd>` : ''}
                  </dl>`
                : ''
            }
          </section>`
        : rwis
          ? `<section class="glass-panel" aria-labelledby="rwis-heading">
              <h2 id="rwis-heading" class="glass-panel__title">CDOT RWIS</h2>
              <dl class="metric-list metric-list--compact">
                <dt>Station</dt><dd>${escapeHtml(String(rwis.name ?? ''))}${rwis.distance_km != null ? ` (${rwis.distance_km} km)` : ''}</dd>
                ${rwis.air_temp_f != null ? `<dt>Air</dt><dd>${Math.round(Number(rwis.air_temp_f))}°F</dd>` : ''}
                ${rwis.surface_temp_f != null ? `<dt>Pavement</dt><dd>${Math.round(Number(rwis.surface_temp_f))}°F</dd>` : ''}
                ${rwis.surface_status ? `<dt>Surface</dt><dd>${escapeHtml(String(rwis.surface_status))}</dd>` : ''}
              </dl>
            </section>`
          : ''
    }

    ${
      rfLabel || cwop
        ? `<section class="glass-panel" aria-labelledby="rf-heading">
            <h2 id="rf-heading" class="glass-panel__title">Field ops / RF</h2>
            ${
              rfLabel
                ? `<p class="rf-badge ${rfClass}"><span class="rf-badge__status">VHF/UHF: ${escapeHtml(rfLabel)}</span>
                    <span class="rf-badge__detail">${escapeHtml(String(rf?.detail ?? 'Model-derived estimate'))}</span></p>`
                : ''
            }
            ${
              cwop
                ? `<dl class="metric-list metric-list--compact">
                    <dt>CWOP / APRS</dt><dd>${escapeHtml(String(cwop.callsign))}${cwop.distance_km != null ? ` · ${cwop.distance_km} km` : ''}</dd>
                    ${cwop.temp_f != null ? `<dt>Temp</dt><dd>${Math.round(Number(cwop.temp_f))}°F</dd>` : ''}
                    ${cwop.humidity != null ? `<dt>Humidity</dt><dd>${Math.round(Number(cwop.humidity))}%</dd>` : ''}
                    ${cwop.wind_speed_mph != null ? `<dt>Wind</dt><dd>${Math.round(Number(cwop.wind_speed_mph))} mph</dd>` : ''}
                  </dl>`
                : ''
            }
          </section>`
        : ''
    }

    ${
      coag
        ? `<section class="glass-panel" aria-labelledby="soil-heading">
            <h2 id="soil-heading" class="glass-panel__title">CoAgMET soil</h2>
            <dl class="metric-list metric-list--compact">
              <dt>Station</dt><dd>${escapeHtml(String(coag.station_name ?? coag.station_id ?? ''))}</dd>
              ${coag.soil_temp_5cm_f != null ? `<dt>Soil 5 cm</dt><dd>${coag.soil_temp_5cm_f}°F</dd>` : ''}
              ${coag.soil_temp_15cm_f != null ? `<dt>Soil 15 cm</dt><dd>${coag.soil_temp_15cm_f}°F</dd>` : ''}
              ${coag.eto_in != null ? `<dt>ET₀</dt><dd>${escapeHtml(String(coag.eto_in))}</dd>` : ''}
            </dl>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="coagmet-heading">Full agriculture section</button>
          </section>`
        : ''
    }

    <nav class="glass-panel glass-panel--nav" aria-label="Deep forecast sections">
      <h2 class="glass-panel__title">Deep forecast</h2>
      <ul class="intel-nav">
        <li><button type="button" class="intel-jump" data-jump-to="hourly-heading">48-hour hourly</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="daily-heading">10-day daily</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="alerts-heading">Alerts &amp; discussion</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="metar-heading">Aviation</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="aqi-heading">Air quality detail</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="links-heading">External tools</button></li>
      </ul>
    </nav>
  `;

  root.querySelectorAll('[data-jump-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.jumpTo;
      if (id) options.onJump?.(id);
    });
  });

  const img = /** @type {HTMLImageElement | null} */ (root.querySelector('[data-cdot-cam]'));
  img?.addEventListener('error', () => {
    const panel = root.querySelector('#cdot-camera-panel');
    if (panel instanceof HTMLElement) {
      img.remove();
      const note = document.createElement('p');
      note.className = 'intel-muted';
      note.textContent = 'Live camera image unavailable; use COtrip link if shown.';
      panel.appendChild(note);
    }
  });

  return { headline };
}
