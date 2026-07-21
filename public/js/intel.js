/**
 * Workspace intel: Hero (At a Glance), Short-Term Outlook, specialty band.
 */

import { synthesizeBottomLine } from './bottom-line.js';
import { aqiCategory, pickAqi } from './aqi.js';
import { escapeHtml, safeHttpsUrl } from './dom.js';
import { isDaytime, weatherIconHtml, wmoLabel } from './icons.js';
import {
  buildOutlookHighlights,
  buildPeriodSummaries,
  formatCompactHourLabel,
  nearestHourIndex,
  sliceCompactHours,
  sourceStatusChips,
} from './outlook.js';
import {
  bindMeteogramScrubber,
  detectPressureDip,
  formatMeteogramHour,
  mbToInHg,
  meteogramHtml,
  meteogramTimeAxisHtml,
  miniBarChartHtml,
} from './sparkline.js';
import { windCompassHtml, windDirLabel } from './wind.js';

export { aqiCategory };

/**
 * @param {number | null | undefined} km
 * @param {boolean} fromYou
 * @returns {string}
 */
function distanceLabel(km, fromYou) {
  if (km == null || !Number.isFinite(Number(km))) return '';
  return fromYou ? ` · ${km} km from you` : ` · ${km} km`;
}

/**
 * @param {unknown} iso
 * @returns {string}
 */
function fmtIntelClock(iso) {
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
 * @param {number | null | undefined} seconds
 * @returns {string | null}
 */
function fmtDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const s = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} m`;
}

/**
 * @param {unknown} iso
 * @returns {string}
 */
function fmtUpdated(iso) {
  if (!iso) return 'Unknown';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(String(iso)));
  } catch {
    return String(iso);
  }
}

/**
 * @param {string} label
 * @param {string | null} value
 * @param {string | null} jumpId
 */
function metricRow(label, value, jumpId) {
  if (value == null || value === '') return '';
  const labelHtml = `<span class="intel-metric__label">${escapeHtml(label)}</span>`;
  const valueHtml = `<span class="intel-metric__value">${escapeHtml(value)}</span>`;
  if (!jumpId) {
    return `<div class="intel-metric">${labelHtml}${valueHtml}</div>`;
  }
  return `<button type="button" class="intel-metric intel-metric--jump" data-jump-to="${escapeHtml(jumpId)}" aria-label="${escapeHtml(label)}: ${escapeHtml(value)}. Jump to details.">
    ${labelHtml}${valueHtml}
  </button>`;
}

/**
 * @param {HTMLElement} root
 * @param {(id: string) => void} [onJump]
 */
function bindJumps(root, onJump) {
  root.querySelectorAll('[data-jump-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.jumpTo;
      if (id) onJump?.(id);
    });
  });
}

/**
 * @param {HTMLElement} root
 */
function bindCamErrors(root) {
  root.querySelectorAll('[data-cdot-cam]').forEach((imgEl) => {
    imgEl.addEventListener('error', () => {
      const img = /** @type {HTMLImageElement} */ (imgEl);
      img.remove();
      const note = document.createElement('p');
      note.className = 'intel-muted';
      note.textContent = 'Live camera image unavailable; use COtrip link if shown.';
      img.parentElement?.appendChild(note);
    });
  });
}

/**
 * @param {string} letter
 * @param {unknown} block
 */
function scaleChip(letter, block) {
  const b = /** @type {Record<string, unknown> | null} */ (
    block && typeof block === 'object' ? block : null
  );
  const scale = b?.scale != null && Number.isFinite(Number(b.scale)) ? Number(b.scale) : null;
  const text = b?.text != null ? String(b.text) : scale == null ? 'n/a' : '';
  const label = scale != null ? `${letter}${scale}` : letter;
  const detail = text && text !== 'none' ? ` ${text}` : scale === 0 ? ' none' : '';
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
  return `<span class="sw-scale sw-scale--${sev}" title="${escapeHtml(letter)} scale${detail}"><span class="sw-scale__code">${escapeHtml(label)}</span><span class="sw-scale__text">${escapeHtml(detail.trim() || 'none')}</span></span>`;
}

/**
 * At a Glance hero card.
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   onJump?: (id: string) => void,
 *   pin?: import('./geo.js').HyperlocalPin | null,
 *   hyperlocal?: {
 *     cameras?: Record<string, unknown>[],
 *     alerts?: Record<string, unknown>[],
 *     pws?: Record<string, unknown> | null,
 *     current?: Record<string, unknown> | null,
 *   } | null,
 *   spaceWeather?: Record<string, unknown> | null,
 *   sources?: unknown[],
 * }} [options]
 * @returns {{ headline: string, destroy: () => void }}
 */
export function renderHero(root, data, options = {}) {
  const catalogCurrent = /** @type {Record<string, unknown> | null} */ (data.current ?? null);
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const spaceWeather = options.spaceWeather ?? null;
  const { headline, priority, jumpTo } = synthesizeBottomLine(data, { spaceWeather });
  const aq = pickAqi(data);
  const cat = aqiCategory(aq.aqi);
  const pin = options.pin ?? null;
  const hyperlocal = options.hyperlocal ?? null;
  const pinCurrent =
    hyperlocal?.current && typeof hyperlocal.current === 'object' ? hyperlocal.current : null;
  const usingPinNow = Boolean(pin && pinCurrent?.temp_f != null);
  const current = usingPinNow ? pinCurrent : catalogCurrent;

  const times = /** @type {string[]} */ (hourly?.time ?? []);
  const hi = times.length ? nearestHourIndex(times) : 0;
  const todayHi = /** @type {number[]} */ (daily?.temperature_2m_max ?? [])[0];
  const todayLo = /** @type {number[]} */ (daily?.temperature_2m_min ?? [])[0];
  const precipChance =
    hourly && Array.isArray(hourly.precipitation_probability)
      ? /** @type {number[]} */ (hourly.precipitation_probability)[hi]
      : null;
  const hourDew =
    current?.dewpoint_f != null
      ? Number(current.dewpoint_f)
      : hourly && Array.isArray(hourly.dewpoint_2m)
        ? /** @type {number[]} */ (hourly.dewpoint_2m)[hi]
        : null;
  const hourVis =
    current?.visibility_m != null
      ? Number(current.visibility_m)
      : hourly && Array.isArray(hourly.visibility)
        ? /** @type {number[]} */ (hourly.visibility)[hi]
        : null;
  const aviation = /** @type {Record<string, unknown> | null} */ (data.aviation ?? null);
  const flightCat =
    aviation?.flight_category != null
      ? `${aviation.flight_category}${aviation.icao ? ` at ${aviation.icao}` : ''}`
      : null;

  const sunrises = /** @type {string[]} */ (daily?.sunrise ?? []);
  const sunsets = /** @type {string[]} */ (daily?.sunset ?? []);
  const isDay =
    current?.is_day === 0 || current?.is_day === 1
      ? current.is_day === 1
      : isDaytime(new Date().toISOString(), sunrises, sunsets);
  const code = /** @type {number | null} */ (current?.weather_code ?? null);

  const windDeg = /** @type {number | null} */ (current?.wind_dir_deg ?? null);
  const compass = windCompassHtml(windDeg, { size: 22 });
  const windMetaParts = [];
  if (current?.wind_gust_mph != null) {
    windMetaParts.push(`gusts ${Math.round(Number(current.wind_gust_mph))}`);
  }
  const windDir = windDirLabel(windDeg);
  if (windDir) windMetaParts.push(`from ${windDir}`);

  const alerts = /** @type {Record<string, unknown>[]} */ (data.alerts ?? []);
  const roads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
  const catalogCams = /** @type {Record<string, unknown>[]} */ (
    roads?.cameras ?? (data.cdot_camera ? [data.cdot_camera] : [])
  );
  const cams = hyperlocal?.cameras?.length ? hyperlocal.cameras : catalogCams;
  const hms = /** @type {Record<string, unknown> | null} */ (data.hms_smoke ?? null);
  const fireWeather = /** @type {Record<string, unknown> | null} */ (data.fire_weather ?? null);
  const nearbyFires = /** @type {Record<string, unknown> | null} */ (data.nearby_fires ?? null);
  const fireRestrictions = /** @type {Record<string, unknown> | null} */ (
    data.fire_restrictions ?? null
  );
  const snotel = /** @type {Record<string, unknown> | null} */ (data.snotel ?? null);
  const links = /** @type {Record<string, unknown>} */ (data.links ?? {});

  const hourUv =
    current?.uv_index != null
      ? Number(current.uv_index)
      : catalogCurrent?.uv_index != null
        ? Number(catalogCurrent.uv_index)
        : hourly && Array.isArray(hourly.uv_index)
          ? /** @type {number[]} */ (hourly.uv_index)[hi]
          : null;
  const tstorm =
    current?.thunderstorm_probability != null
      ? Number(current.thunderstorm_probability)
      : hourly && Array.isArray(hourly.thunderstorm_probability)
        ? /** @type {number[]} */ (hourly.thunderstorm_probability)[hi]
        : null;

  const pressureDisplay =
    current?.surface_pressure_mb != null
      ? current.surface_pressure_mb
      : current?.pressure_mb != null
        ? current.pressure_mb
        : catalogCurrent?.surface_pressure_mb != null
          ? catalogCurrent.surface_pressure_mb
          : catalogCurrent?.pressure_mb;

  const pinSourceLabel =
    pin?.source === 'gps' ? 'GPS' : pin?.source === 'address' ? 'address' : 'network';
  const pinNowNote =
    pin && !usingPinNow
      ? `<p class="intel-muted" role="status">
          Pin set (${escapeHtml(pinSourceLabel)}) — cameras and nearby PWS are ranked from your coordinates.
          Live temperature at the pin is temporarily unavailable; showing nearest catalog point.
        </p>`
      : '';

  const name = String(data.name ?? data.slug ?? 'Colorado');
  const locTitle = `${name}, CO`;
  const updatedAt = data.updatedAt ?? data.updated_at ?? null;
  const chips = sourceStatusChips(options.sources ?? []);
  const chipHtml = chips.length
    ? `<ul class="source-chips" aria-label="Data source status">${chips
        .map(
          (c) =>
            `<li><span class="source-chip source-chip--${escapeHtml(c.status)}" title="${escapeHtml(c.id)}: ${escapeHtml(c.status)}" aria-label="${escapeHtml(c.id)} ${escapeHtml(c.status)}">${escapeHtml(c.label)}</span></li>`,
        )
        .join('')}</ul>`
    : '';

  const previewCam = cams[0];
  const camImage = previewCam ? safeHttpsUrl(previewCam.imageUrl) : null;
  const camPage = previewCam ? safeHttpsUrl(previewCam.pageUrl) : null;

  root.innerHTML = `
    <section class="glass-panel glance-hero${usingPinNow ? ' glass-panel--pin-now' : ''}" aria-labelledby="glance-hero-heading">
      <div class="glance-hero__top">
        <div class="glance-hero__identity">
          <h2 id="glance-hero-heading" class="glance-hero__title">At a Glance</h2>
          <p class="glance-hero__place">${escapeHtml(locTitle)}${usingPinNow ? ' · At your location' : ''}</p>
          <p class="glance-hero__meta">
            <span id="glance-clock" class="glance-hero__clock" aria-live="polite"></span>
            <span class="glance-hero__updated">Updated ${escapeHtml(fmtUpdated(updatedAt))}</span>
          </p>
        </div>
        <button type="button" class="aqi-ring ${cat.className}" data-jump-to="aqi-heading" aria-label="${escapeHtml(`Air quality ${aq.aqi != null ? Math.round(aq.aqi) : 'unavailable'}: ${cat.label}${aq.source ? ` from ${aq.source}` : ''}. Open air quality details.`)}">
          <span class="aqi-ring__value">${aq.aqi != null ? Math.round(aq.aqi) : '—'}</span>
          <span class="aqi-ring__label">AQI</span>
          <span class="aqi-ring__cat">${escapeHtml(cat.label)}</span>
        </button>
      </div>
      ${pinNowNote}
      <div class="glance-hero__headline" aria-labelledby="bottom-line-heading">
        <h3 id="bottom-line-heading" class="sr-only">Bottom line</h3>
        ${
          jumpTo
            ? `<button type="button" class="bottom-line bottom-line--${escapeHtml(priority)} bottom-line--jump" data-jump-to="${escapeHtml(jumpTo)}" aria-label="${escapeHtml(headline)}. Open related details.">${escapeHtml(headline)}</button>`
            : `<p class="bottom-line bottom-line--${escapeHtml(priority)}" role="status">${escapeHtml(headline)}</p>`
        }
      </div>
      ${
        alerts.length
          ? `<ul class="glance-alert-banners" aria-label="Active NWS alerts">${alerts
              .slice(0, 6)
              .map((a) => {
                const sev = String(a.severity ?? 'Unknown');
                return `<li><button type="button" class="glance-alert-banner glance-alert-banner--${escapeHtml(sev.toLowerCase())}" data-jump-to="alerts-heading"><span class="glance-alert-banner__sev">${escapeHtml(sev)}</span> <span class="glance-alert-banner__event">${escapeHtml(String(a.event ?? 'Alert'))}</span></button></li>`;
              })
              .join('')}</ul>`
          : ''
      }
      <div class="intel-now">
        ${
          current?.temp_f != null
            ? `<button type="button" class="intel-now-hero" data-jump-to="hourly-heading" aria-label="${escapeHtml(`Current conditions ${Math.round(Number(current.temp_f))} degrees Fahrenheit, ${String(current.condition ?? wmoLabel(code))}. Open hourly forecast.`)}">
                ${weatherIconHtml(code, { isDay, size: 48, className: 'weather-icon', alt: '' })}
                <span class="intel-now-hero__text">
                  <span class="intel-temp">${Math.round(Number(current.temp_f))}°F</span>
                  <span class="intel-cond">${escapeHtml(String(current.condition ?? wmoLabel(code)))}</span>
                  ${
                    current?.feels_like_f != null
                      ? `<span class="intel-feels">Feels like ${Math.round(Number(current.feels_like_f))}°F</span>`
                      : ''
                  }
                  ${
                    todayHi != null && todayLo != null
                      ? `<span class="intel-range">High ${Math.round(todayHi)}° · Low ${Math.round(todayLo)}°</span>`
                      : ''
                  }
                </span>
              </button>`
            : `<p class="empty-state">Current conditions unavailable.</p>`
        }
        ${
          current?.wind_speed_mph != null
            ? `<button type="button" class="intel-now-wind" data-jump-to="hourly-heading" aria-label="${escapeHtml(`Wind ${Math.round(Number(current.wind_speed_mph))} miles per hour${windMetaParts.length ? `, ${windMetaParts.join(', ')}` : ''}. Open hourly forecast.`)}">
                ${compass || ''}
                <span class="intel-now-wind__text">
                  <span class="intel-now-wind__speed">${Math.round(Number(current.wind_speed_mph))} mph</span>
                  ${windMetaParts.length ? `<span class="intel-now-wind__meta">${escapeHtml(windMetaParts.join(' · '))}</span>` : ''}
                </span>
              </button>`
            : ''
        }
      </div>
      <div class="intel-metrics glance-metrics">
        ${metricRow(
          'Feels like',
          current?.feels_like_f != null ? `${Math.round(Number(current.feels_like_f))}°F` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Today’s range',
          todayHi != null && todayLo != null
            ? `High ${Math.round(todayHi)}°F · Low ${Math.round(todayLo)}°F`
            : null,
          'daily-heading',
        )}
        ${metricRow(
          'Precip chance',
          precipChance != null ? `${Math.round(Number(precipChance))}% this hour` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Humidity',
          current?.humidity != null ? `${current.humidity}%` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Dewpoint',
          hourDew != null ? `${Math.round(Number(hourDew))}°F` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Rainfall today',
          current?.precip_today_in != null
            ? `${Number(current.precip_today_in).toFixed(2)} in`
            : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Cloud cover',
          current?.cloud_cover != null ? `${current.cloud_cover}%` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Pressure',
          pressureDisplay != null ? `${Math.round(Number(pressureDisplay))} mb` : null,
          'hourly-heading',
        )}
        ${metricRow(
          'UV index',
          hourUv != null && Number.isFinite(hourUv) ? String(Math.round(hourUv)) : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Visibility',
          hourVis != null && Number.isFinite(hourVis)
            ? `${(Number(hourVis) / 1609.34).toFixed(1)} mi`
            : null,
          'hourly-heading',
        )}
        ${metricRow(
          'Snow depth',
          snotel?.snow_depth_in != null ? `${snotel.snow_depth_in} in (SNOTEL)` : null,
          snotel?.snow_depth_in != null ? 'snowpack-heading' : null,
        )}
        ${metricRow(
          'Thunderstorm',
          tstorm != null && Number.isFinite(tstorm) ? `${Math.round(tstorm)}%` : null,
          'hourly-heading',
        )}
        ${metricRow('Aviation', flightCat, flightCat ? 'metar-heading' : null)}
      </div>
      <div class="glance-hero__previews">
        ${
          camImage || camPage
            ? `<figure class="glance-preview-cam">
                <figcaption class="intel-muted">${escapeHtml(String(previewCam?.name ?? 'Road camera'))}</figcaption>
                ${camImage ? `<img class="cdot-cam" src="${escapeHtml(camImage)}?t=${Date.now()}" alt="CDOT traffic camera: ${escapeHtml(String(previewCam?.name ?? 'Colorado roadway'))}" loading="lazy" decoding="async" data-cdot-cam />` : ''}
                ${camPage ? `<p><a class="btn btn-secondary btn-sm" href="${escapeHtml(camPage)}" target="_blank" rel="noopener noreferrer">Open on COtrip <span class="sr-only">(opens in new tab)</span></a></p>` : ''}
              </figure>`
            : ''
        }
        <button type="button" class="btn btn-secondary btn-sm" id="glance-radar-jump">View radar map</button>
      </div>
      ${(() => {
        const day1 = /** @type {Record<string, unknown> | null} */ (fireWeather?.day1 ?? null);
        const day2 = /** @type {Record<string, unknown> | null} */ (fireWeather?.day2 ?? null);
        const windRh = String(day1?.windRh ?? 'none');
        const windRh2 = String(day2?.windRh ?? 'none');
        const spcActive =
          /^(elevated|critical|extreme)$/.test(windRh) ||
          /^(elevated|critical|extreme)$/.test(windRh2);
        const smokeActive = Boolean(hms && hms.density && hms.density !== 'none');
        const incidents = /** @type {Record<string, unknown>[]} */ (nearbyFires?.incidents ?? []);
        const firesActive = incidents.length > 0;
        const banActive = fireRestrictions?.status === 'restriction_reported';
        if (!spcActive && !smokeActive && !firesActive && !banActive) return '';
        const bits = [];
        if (spcActive) {
          const label = windRh !== 'none' ? windRh : windRh2;
          bits.push(
            `SPC Day ${windRh !== 'none' ? '1' : '2'} Wind/RH: <strong>${escapeHtml(label)}</strong>`,
          );
        }
        if (smokeActive) {
          bits.push(
            `HMS smoke: <strong>${escapeHtml(String(hms?.density))}</strong>${hms?.observed ? ` · ${escapeHtml(String(hms.observed))}` : ''}`,
          );
        }
        if (firesActive) {
          const nearest = incidents[0];
          bits.push(
            `Nearby fire: <strong>${escapeHtml(String(nearest?.name ?? 'Incident'))}</strong>${
              nearest?.distance_km != null ? ` (${Number(nearest.distance_km).toFixed(1)} km)` : ''
            }`,
          );
        }
        if (banActive) {
          bits.push(
            `Burn restriction: <strong>${escapeHtml(String(fireRestrictions?.county ?? data.county ?? 'county'))}</strong>`,
          );
        }
        return `<div class="intel-now-extras">
            <h3 class="intel-now-extras__title">Fire weather</h3>
            <p class="intel-now-extras__body">${bits.join('<br />')}</p>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="smoke-heading">Fire weather &amp; restrictions detail</button>
          </div>`;
      })()}
      ${(() => {
        const pollenUrl = safeHttpsUrl(String(links.pollen ?? ''));
        const nabLinks = /** @type {{ name?: string, url?: string }[]} */ (links.nab_links ?? []);
        const zip = links.pollen_zip != null ? String(links.pollen_zip) : null;
        const city = links.pollen_city != null ? String(links.pollen_city) : null;
        const nabItems = nabLinks
          .map((l) => {
            const u = safeHttpsUrl(String(l.url ?? ''));
            if (!u || !l.name) return '';
            return `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(l.name))} <span class="sr-only">(opens in new tab)</span></a></li>`;
          })
          .filter(Boolean)
          .join('');
        if (!pollenUrl && !nabItems) return '';
        const pollenLabel = zip
          ? `Pollen.com (ZIP ${zip}${city ? `, ${city}` : ''})`
          : 'Pollen.com forecast';
        return `<div class="intel-now-extras">
            <h3 class="intel-now-extras__title">Health &amp; pollen</h3>
            <p class="intel-muted intel-now-extras__note">Live US pollen counts are not free to redistribute — open offsite forecasts. AQI and UV are shown above.</p>
            <ul class="intel-link-list">
              ${
                pollenUrl
                  ? `<li><a href="${escapeHtml(pollenUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pollenLabel)} <span class="sr-only">(opens in new tab)</span></a></li>`
                  : ''
              }
              ${nabItems}
            </ul>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="aqi-heading">Air quality &amp; pollen detail</button>
          </div>`;
      })()}
      <div class="glance-freshness">
        <span class="glance-freshness__label">Sources</span>
        ${chipHtml || '<span class="intel-muted">Status unavailable</span>'}
      </div>
    </section>
  `;

  // map-heading may not exist — jump to map container via radar summary
  const radarJump = root.querySelector('#glance-radar-jump');
  radarJump?.addEventListener('click', (e) => {
    e.preventDefault();
    const mapEl = document.getElementById('map-container');
    if (mapEl) {
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      mapEl.focus?.({ preventScroll: true });
    }
  });

  bindJumps(root, options.onJump);
  bindCamErrors(root);

  const clockEl = /** @type {HTMLElement | null} */ (root.querySelector('#glance-clock'));
  function tickClock() {
    if (!clockEl) return;
    try {
      clockEl.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());
    } catch {
      clockEl.textContent = new Date().toLocaleTimeString();
    }
  }
  tickClock();
  const clockTimer = setInterval(tickClock, 1000);

  return {
    headline,
    destroy: () => {
      clearInterval(clockTimer);
    },
  };
}

/**
 * Short-Term Outlook (compact hourly; full 48h is a collapsed deep section).
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   onJump?: (id: string) => void,
 *   spaceWeather?: Record<string, unknown> | null,
 * }} [options]
 * @returns {{ destroy: () => void }}
 */
export function renderOutlook(root, data, options = {}) {
  const hourly = /** @type {Record<string, unknown> | null} */ (data.hourly ?? null);
  const daily = /** @type {Record<string, unknown> | null} */ (data.daily ?? null);
  const afd = /** @type {Record<string, unknown> | null} */ (data.afd ?? null);

  const compact = sliceCompactHours(hourly, { count: 10 });
  const periods = buildPeriodSummaries(hourly, daily);
  const highlights = buildOutlookHighlights(hourly, { hours: 48 });

  const times = /** @type {string[]} */ (hourly?.time ?? []);
  const hi = times.length ? nearestHourIndex(times) : 0;
  const sliceEnd = Math.min(times.length, hi + 24);
  const sliceStart = Math.max(0, sliceEnd - 24);
  const temps = /** @type {(number | null)[]} */ (hourly?.temperature_2m ?? []).slice(
    sliceStart,
    sliceEnd,
  );
  const winds = /** @type {(number | null)[]} */ (hourly?.wind_speed_10m ?? []).slice(
    sliceStart,
    sliceEnd,
  );
  const gusts = /** @type {(number | null)[]} */ (hourly?.wind_gusts_10m ?? []).slice(
    sliceStart,
    sliceEnd,
  );
  const pressureMb = /** @type {(number | null)[]} */ (hourly?.pressure_msl ?? []).slice(
    sliceStart,
    sliceEnd,
  );
  const pressureIn = pressureMb.map((v) =>
    Number.isFinite(Number(v)) ? mbToInHg(Number(v)) : null,
  );
  const dip = detectPressureDip(pressureIn);
  const chartTimes = times.slice(sliceStart, sliceEnd);
  const probs = /** @type {(number | null)[]} */ (hourly?.precipitation_probability ?? []).slice(
    sliceStart,
    sliceEnd,
  );

  const hourCards = compact
    .map((row) => {
      const windBit = row.wind_mph != null ? `${Math.round(row.wind_mph)} mph` : '—';
      return `<li class="outlook-hour-card">
        <span class="outlook-hour-card__time">${escapeHtml(formatCompactHourLabel(row.time))}</span>
        ${weatherIconHtml(row.weather_code, { isDay: row.is_day, size: 32, className: 'weather-icon weather-icon--sm', alt: wmoLabel(row.weather_code) })}
        <span class="outlook-hour-card__temp">${row.temp_f != null ? `${Math.round(row.temp_f)}°` : '—'}</span>
        <span class="outlook-hour-card__feels">${row.feels_like_f != null ? `Feels ${Math.round(row.feels_like_f)}°` : ''}</span>
        <span class="outlook-hour-card__precip">${row.precip_pct != null ? `${Math.round(row.precip_pct)}%` : '—'}</span>
        <span class="outlook-hour-card__wind">${escapeHtml(windBit)}</span>
      </li>`;
    })
    .join('');

  const periodHtml = periods
    .map(
      (p) => `<article class="outlook-period" aria-labelledby="outlook-period-${p.id}">
        <h3 id="outlook-period-${p.id}" class="outlook-period__title">
          ${weatherIconHtml(p.weather_code, { isDay: p.is_day, size: 28, className: 'weather-icon weather-icon--sm', alt: '' })}
          ${escapeHtml(p.label)}
        </h3>
        <p class="outlook-period__body">${escapeHtml(p.summary)}</p>
      </article>`,
    )
    .join('');

  const highlightHtml = highlights.length
    ? `<ul class="outlook-highlights">${highlights
        .map((h) => `<li>${escapeHtml(h.text)}</li>`)
        .join('')}</ul>`
    : `<p class="intel-muted">No standout changes in the next 48 hours.</p>`;

  const afdSnippet =
    afd?.snippet != null
      ? String(afd.snippet).slice(0, 220) + (String(afd.snippet).length > 220 ? '…' : '')
      : '';

  root.innerHTML = `
    <section class="glass-panel outlook-card" aria-labelledby="outlook-heading">
      <h2 id="outlook-heading" class="glass-panel__title">Short-Term Outlook</h2>
      <div class="outlook-hours-wrap">
        <h3 class="outlook-subtitle" id="outlook-hours-heading">Next ${compact.length || 10} hours</h3>
        ${
          compact.length
            ? `<ul class="outlook-hours" aria-labelledby="outlook-hours-heading">${hourCards}</ul>`
            : `<p class="empty-state">Hourly forecast unavailable.</p>`
        }
        <button type="button" class="btn outlook-hourly-cta" data-jump-to="hourly-heading">
          View Full 48-Hour Hourly Forecast
        </button>
      </div>
      <div class="outlook-periods" aria-label="Today and tonight">
        ${periodHtml || '<p class="intel-muted">Period summaries unavailable.</p>'}
      </div>
      ${
        afdSnippet
          ? `<p class="outlook-afd"><strong>NWS discussion:</strong> ${escapeHtml(afdSnippet)}
              <button type="button" class="btn btn-link intel-jump" data-jump-to="alerts-heading">Full discussion</button></p>`
          : ''
      }
      <div class="outlook-highlights-block">
        <h3 class="outlook-subtitle">24–48 hour highlights</h3>
        ${highlightHtml}
      </div>
      <section class="outlook-meteogram" aria-labelledby="meteogram-heading">
        <h3 id="meteogram-heading" class="outlook-subtitle">Next 24 hours</h3>
        <div class="meteogram-stack" data-meteogram-stack>
          <p class="meteogram-scrub-readout" data-meteogram-readout aria-live="polite">
            Drag the marker across the charts to inspect each hour.
          </p>
          <div class="meteogram-stack__body">
            <div class="meteogram-row">
              <span class="meteogram-row__label">Temp °F</span>
              <div class="meteogram-row__chart">
                <div class="meteogram-plot">
                  ${meteogramHtml(temps, { color: '#0369a1', label: 'Temperature trend Fahrenheit', fill: true }) || '<p class="empty-state">No temperature series</p>'}
                  ${meteogramTimeAxisHtml(chartTimes)}
                </div>
              </div>
            </div>
            <div class="meteogram-row">
              <span class="meteogram-row__label">Precip chance</span>
              <div class="meteogram-row__chart">
                <div class="meteogram-plot">
                  ${miniBarChartHtml(probs, { color: '#0284c7' }) || '<p class="empty-state">No precip probability</p>'}
                  ${meteogramTimeAxisHtml(chartTimes)}
                </div>
              </div>
            </div>
            <details class="outlook-more-charts">
              <summary>More charts (pressure &amp; wind)</summary>
              <div class="meteogram-row">
                <span class="meteogram-row__label">Pressure inHg${dip.dip ? ' · front dip' : ''}</span>
                <div class="meteogram-row__chart">
                  <div class="meteogram-plot">
                    ${
                      meteogramHtml(pressureIn, {
                        color: dip.dip ? '#a16207' : '#4338ca',
                        label: dip.dip
                          ? `Pressure trend with rapid dip of ${dip.delta.toFixed(2)} inches`
                          : 'Barometric pressure trend inches of mercury',
                        highlightFrom: dip.dip ? dip.index : undefined,
                        fill: true,
                      }) || '<p class="empty-state">No pressure series</p>'
                    }
                    ${meteogramTimeAxisHtml(chartTimes)}
                  </div>
                </div>
              </div>
              <div class="meteogram-row">
                <span class="meteogram-row__label">Wind / gust mph</span>
                <div class="meteogram-row__chart">
                  <div class="meteogram-plot">
                    ${
                      meteogramHtml(winds, {
                        color: '#166534',
                        secondary: gusts,
                        secondaryColor: '#c2410c',
                        label: 'Wind speed and gusts miles per hour',
                        fill: false,
                      }) || '<p class="empty-state">No wind series</p>'
                    }
                    ${meteogramTimeAxisHtml(chartTimes)}
                  </div>
                </div>
              </div>
            </details>
            <div class="meteogram-scrub-layer" data-meteogram-scrub-layer>
              <div class="meteogram-scrubber" data-meteogram-scrubber style="left: 0%">
                <div class="meteogram-scrubber__line" aria-hidden="true"></div>
                <button
                  type="button"
                  class="meteogram-scrubber__handle"
                  data-meteogram-handle
                  role="slider"
                  aria-label="Forecast hour marker"
                  aria-valuemin="0"
                  aria-valuemax="${Math.max(0, chartTimes.length - 1)}"
                  aria-valuenow="0"
                ></button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  `;

  bindJumps(root, options.onJump);

  const stack = /** @type {HTMLElement | null} */ (root.querySelector('[data-meteogram-stack]'));
  if (stack && chartTimes.length) {
    /**
     * @param {number | null | undefined} v
     * @param {string} unit
     * @param {number} [digits]
     */
    function fmt(v, unit, digits = 0) {
      if (v == null || !Number.isFinite(Number(v))) return null;
      const n = Number(v);
      return `${digits > 0 ? n.toFixed(digits) : Math.round(n)}${unit}`;
    }

    bindMeteogramScrubber(stack, {
      times: chartTimes,
      initialIndex: 0,
      formatReadout(i) {
        const parts = [formatMeteogramHour(chartTimes[i])];
        const t = fmt(temps[i], '°F');
        if (t) parts.push(t);
        const p = fmt(pressureIn[i], ' inHg', 2);
        if (p) parts.push(p);
        const w = fmt(winds[i], ' mph');
        const g = fmt(gusts[i], '');
        if (w) parts.push(g ? `${w} (gust ${g})` : w);
        const pr = fmt(probs[i], '% precip');
        if (pr) parts.push(pr);
        return parts.join(' · ');
      },
    });
  }

  return {
    destroy: () => {},
  };
}

/**
 * Full-width specialty intel band.
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} data
 * @param {{
 *   onJump?: (id: string) => void,
 *   pin?: import('./geo.js').HyperlocalPin | null,
 *   hyperlocal?: {
 *     cameras?: Record<string, unknown>[],
 *     alerts?: Record<string, unknown>[],
 *     pws?: Record<string, unknown> | null,
 *     current?: Record<string, unknown> | null,
 *   } | null,
 *   spaceWeather?: Record<string, unknown> | null,
 * }} [options]
 */
export function renderSpecialtyIntel(root, data, options = {}) {
  const pin = options.pin ?? null;
  const hyperlocal = options.hyperlocal ?? null;
  const fromYou = Boolean(pin);
  const spaceWeather = options.spaceWeather ?? null;

  const roads = /** @type {Record<string, unknown> | null} */ (data.cdot_roads ?? null);
  const catalogCams = /** @type {Record<string, unknown>[]} */ (
    roads?.cameras ?? (data.cdot_camera ? [data.cdot_camera] : [])
  );
  const cams = hyperlocal?.cameras?.length ? hyperlocal.cameras : catalogCams;
  const rwis = /** @type {Record<string, unknown> | null} */ (
    roads?.rwis ?? data.cdot_rwis ?? null
  );
  const catalogRoadAlerts = /** @type {Record<string, unknown>[]} */ (roads?.alerts ?? []);
  const roadAlerts = hyperlocal?.alerts?.length ? hyperlocal.alerts : catalogRoadAlerts;
  const catalogPws = /** @type {Record<string, unknown> | null} */ (data.pws ?? null);
  const pws = hyperlocal?.pws && typeof hyperlocal.pws === 'object' ? hyperlocal.pws : catalogPws;
  const pwsPrimary = /** @type {Record<string, unknown> | null} */ (pws?.primary ?? null);
  const cwop = pwsPrimary ?? /** @type {Record<string, unknown> | null} */ (data.cwop ?? null);
  const coag = /** @type {Record<string, unknown> | null} */ (data.coagmet ?? null);
  const snotel = /** @type {Record<string, unknown> | null} */ (data.snotel ?? null);
  const links = /** @type {Record<string, unknown>} */ (data.links ?? {});
  const pwsLinks =
    pws?.links && typeof pws.links === 'object'
      ? /** @type {Record<string, unknown>} */ (pws.links)
      : {};
  const webcamLinks = /** @type {{ name?: string, url?: string }[]} */ (links.webcam_links ?? []);

  let rf = /** @type {Record<string, unknown> | null} */ (data.rf_comms ?? null);
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

  const sw = spaceWeather;
  const swScales = /** @type {Record<string, unknown> | null} */ (sw?.scales ?? null);
  const swKp = /** @type {Record<string, unknown> | null} */ (sw?.kp ?? null);
  const swBoulder = /** @type {Record<string, unknown> | null} */ (sw?.boulder_kp ?? null);
  const swSfi = /** @type {Record<string, unknown> | null} */ (sw?.sfi ?? null);
  const swAurora = /** @type {Record<string, unknown> | null} */ (sw?.aurora_co ?? null);
  const swHf = /** @type {Record<string, unknown> | null} */ (sw?.hf ?? null);
  const swDay = /** @type {Record<string, string> | null} */ (swHf?.day ?? null);
  const swNight = /** @type {Record<string, string> | null} */ (swHf?.night ?? null);
  const hfSummaryBits = [];
  if (swDay?.['20m']) hfSummaryBits.push(`20m day: ${swDay['20m']}`);
  if (swNight?.['40m']) hfSummaryBits.push(`40m night: ${swNight['40m']}`);
  if (swDay?.['10m']) hfSummaryBits.push(`10m day: ${swDay['10m']}`);
  const showHamPanel = Boolean(rfLabel || sw);

  const parts = [];

  {
    const topAlert = roadAlerts[0];
    if (topAlert || cams.length || rwis) {
      const alertBits = roadAlerts
        .slice(0, 3)
        .map((a) => {
          const flags = [
            a.chain_law ? 'chain law' : null,
            a.closure ? 'closure' : null,
            a.pass_relevant ? 'pass' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return `<li><button type="button" class="intel-jump" data-jump-to="roads-heading"><strong>${escapeHtml(String(a.title ?? 'Travel alert'))}</strong>${distanceLabel(/** @type {number | null} */ (a.distance_km), fromYou && Boolean(hyperlocal?.alerts?.length))}${flags ? ` · ${escapeHtml(flags)}` : ''}</button></li>`;
        })
        .join('');
      parts.push(`<section class="glass-panel" aria-labelledby="roads-intel-heading">
            <h2 id="roads-intel-heading" class="glass-panel__title">Roads &amp; passes</h2>
            ${
              topAlert
                ? `<ul class="intel-alert-list">${alertBits}</ul>
                   <button type="button" class="btn btn-link intel-jump" data-jump-to="roads-heading">All road alerts</button>`
                : `<p class="intel-muted">No nearby CDOT travel alerts.</p>`
            }
            ${
              rwis
                ? `<dl class="metric-list metric-list--compact">
                    <dt>Nearest RWIS</dt><dd>${escapeHtml(String(rwis.name ?? ''))}${distanceLabel(/** @type {number | null} */ (rwis.distance_km), false)}</dd>
                    ${rwis.air_temp_f != null ? `<dt>Air</dt><dd>${Math.round(Number(rwis.air_temp_f))}°F</dd>` : ''}
                    ${rwis.surface_temp_f != null ? `<dt>Pavement</dt><dd>${Math.round(Number(rwis.surface_temp_f))}°F${rwis.surface_status ? ` · ${escapeHtml(String(rwis.surface_status))}` : ''}</dd>` : ''}
                    ${rwis.wind_speed_mph != null ? `<dt>Wind</dt><dd>${Math.round(Number(rwis.wind_speed_mph))} mph</dd>` : ''}
                  </dl>`
                : ''
            }
            <p><a class="btn btn-secondary btn-sm" href="https://maps.cotrip.org/" target="_blank" rel="noopener noreferrer" aria-label="Open COtrip map (opens in new tab)">Open COtrip</a></p>
          </section>`);
    }
  }

  if (cams.length || webcamLinks.length) {
    const camHtml = cams
      .slice(0, 3)
      .map((c) => {
        const imageUrl = safeHttpsUrl(c.imageUrl);
        const pageUrl = safeHttpsUrl(c.pageUrl);
        return `<figure class="cdot-cam-card">
              <figcaption class="intel-muted">${escapeHtml(String(c.name ?? 'Camera'))}${distanceLabel(/** @type {number | null} */ (c.distance_km), fromYou && Boolean(hyperlocal?.cameras?.length))}</figcaption>
              ${
                imageUrl
                  ? `<img class="cdot-cam" src="${escapeHtml(imageUrl)}?t=${Date.now()}" alt="CDOT traffic camera: ${escapeHtml(String(c.name ?? 'Colorado roadway'))}" loading="lazy" decoding="async" data-cdot-cam />`
                  : ''
              }
              ${pageUrl ? `<p><a class="btn btn-secondary btn-sm" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(String(c.name ?? 'camera'))} on COtrip (opens in new tab)">Open on COtrip</a></p>` : ''}
            </figure>`;
      })
      .join('');
    const localLinks = webcamLinks
      .filter((l) => safeHttpsUrl(l.url))
      .map(
        (l) =>
          `<li><a href="${escapeHtml(String(safeHttpsUrl(l.url)))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(String(l.name ?? 'Webcam'))} (opens in new tab)">${escapeHtml(String(l.name ?? 'Local webcam'))}</a></li>`,
      )
      .join('');
    parts.push(`<section class="glass-panel" aria-labelledby="cam-heading" id="cdot-camera-panel">
            <h2 id="cam-heading" class="glass-panel__title">Road cameras</h2>
            <div class="cdot-cam-strip">${camHtml || '<p class="intel-muted">No CDOT camera assigned.</p>'}</div>
            ${
              localLinks
                ? `<h3 class="glass-panel__subtitle">Local webcams</h3>
                   <ul class="link-list link-list--compact">${localLinks}</ul>
                   <p class="intel-muted">City and county portals open in a new tab.</p>`
                : ''
            }
          </section>`);
  }

  if (showHamPanel) {
    parts.push(`<section class="glass-panel" aria-labelledby="rf-heading">
            <h2 id="rf-heading" class="glass-panel__title">Ham radio / RF</h2>
            ${
              swScales
                ? `<div class="sw-scales" role="group" aria-label="NOAA space weather scales">
                    ${scaleChip('R', swScales.R)}
                    ${scaleChip('S', swScales.S)}
                    ${scaleChip('G', swScales.G)}
                  </div>`
                : ''
            }
            ${
              swSfi || swKp
                ? `<dl class="metric-list metric-list--compact">
                    ${swSfi?.value != null ? `<dt>SFI</dt><dd>${Math.round(Number(swSfi.value))}${swSfi.ninety_day_mean != null ? ` <span class="intel-muted">(90d ${Math.round(Number(swSfi.ninety_day_mean))})</span>` : ''}</dd>` : ''}
                    ${swKp?.value != null ? `<dt>Kp</dt><dd>${Number(swKp.value).toFixed(1)}${swBoulder?.value != null ? ` <span class="intel-muted">· Boulder ${Number(swBoulder.value).toFixed(1)}</span>` : ''}</dd>` : ''}
                  </dl>`
                : ''
            }
            ${
              swAurora
                ? `<p class="sw-aurora sw-aurora--${escapeHtml(String(swAurora.chance ?? 'unlikely'))}"><span class="sw-aurora__label">Aurora (CO): ${escapeHtml(String(swAurora.chance ?? 'unlikely'))}</span>
                    <span class="sw-aurora__detail">${escapeHtml(String(swAurora.detail ?? ''))}</span></p>`
                : ''
            }
            ${
              hfSummaryBits.length
                ? `<p class="sw-hf-summary"><span class="sw-hf-summary__label">HF (estimate)</span> ${escapeHtml(hfSummaryBits.join(' · '))}</p>`
                : ''
            }
            ${
              rfLabel
                ? `<p class="rf-badge ${rfClass}"><span class="rf-badge__status">VHF/UHF ducting: ${escapeHtml(rfLabel)}</span>
                    <span class="rf-badge__detail">${escapeHtml(String(rf?.detail ?? 'Model-derived estimate'))}</span></p>`
                : ''
            }
            ${
              sw
                ? `<button type="button" class="btn btn-link intel-jump" data-jump-to="ham-heading">Full ham &amp; space weather</button>`
                : ''
            }
          </section>`);
  }

  if (pwsPrimary || cwop) {
    parts.push(`<section class="glass-panel" aria-labelledby="pws-heading">
            <h2 id="pws-heading" class="glass-panel__title">Nearby PWS</h2>
            <dl class="metric-list metric-list--compact">
              <dt>Station</dt><dd>${escapeHtml(String(cwop?.callsign ?? ''))}${cwop?.network ? ` · ${escapeHtml(String(cwop.network))}` : ''}${distanceLabel(/** @type {number | null} */ (cwop?.distance_km), fromYou && Boolean(hyperlocal?.pws))}</dd>
              ${cwop?.temp_f != null ? `<dt>Temp</dt><dd>${Math.round(Number(cwop.temp_f))}°F</dd>` : ''}
              ${cwop?.humidity != null ? `<dt>Humidity</dt><dd>${Math.round(Number(cwop.humidity))}%</dd>` : ''}
              ${cwop?.wind_speed_mph != null ? `<dt>Wind</dt><dd>${Math.round(Number(cwop.wind_speed_mph))} mph</dd>` : ''}
              ${cwop?.observed ? `<dt>Observed</dt><dd>${escapeHtml(String(cwop.observed))}</dd>` : ''}
            </dl>
            ${
              pwsLinks.aprs && safeHttpsUrl(String(pwsLinks.aprs))
                ? `<p><a class="btn btn-secondary btn-sm" href="${escapeHtml(String(safeHttpsUrl(String(pwsLinks.aprs))))}" target="_blank" rel="noopener noreferrer" aria-label="Open station on aprs.fi (opens in new tab)">aprs.fi</a></p>`
                : safeHttpsUrl(links.pws)
                  ? `<p><a class="btn btn-secondary btn-sm" href="${escapeHtml(String(safeHttpsUrl(links.pws)))}" target="_blank" rel="noopener noreferrer" aria-label="Weather Underground PWS (opens in new tab)">Weather Underground</a></p>`
                  : ''
            }
          </section>`);
  }

  {
    const astro = /** @type {Record<string, unknown> | null} */ (data.astronomy ?? null);
    const moon = /** @type {Record<string, unknown> | null} */ (astro?.moon ?? null);
    if (astro) {
      const civil = /** @type {Record<string, unknown>} */ (astro.civil_twilight ?? {});
      const dayLen = fmtDuration(/** @type {number | null} */ (astro.day_length_s ?? null));
      parts.push(`<section class="glass-panel" aria-labelledby="astro-intel-heading">
            <h2 id="astro-intel-heading" class="glass-panel__title">Astronomy</h2>
            <dl class="metric-list metric-list--compact">
              <dt>Sunrise</dt><dd>${escapeHtml(fmtIntelClock(astro.sunrise))}</dd>
              <dt>Sunset</dt><dd>${escapeHtml(fmtIntelClock(astro.sunset))}</dd>
              ${dayLen ? `<dt>Length of day</dt><dd>${escapeHtml(dayLen)}</dd>` : ''}
              <dt>Civil twilight</dt><dd>${escapeHtml(fmtIntelClock(civil.begin))} – ${escapeHtml(fmtIntelClock(civil.end))}</dd>
              ${
                moon
                  ? `<dt>Moon</dt><dd>${escapeHtml(String(moon.phase_label ?? '—'))}${moon.illumination_pct != null ? ` · ${Math.round(Number(moon.illumination_pct))}% lit` : ''}</dd>
                     <dt>Moonrise</dt><dd>${escapeHtml(fmtIntelClock(moon.rise))}</dd>
                     <dt>Moonset</dt><dd>${escapeHtml(fmtIntelClock(moon.set))}</dd>`
                  : ''
              }
            </dl>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="astronomy-heading">Full astronomy</button>
          </section>`);
    }
  }

  if (coag) {
    parts.push(`<section class="glass-panel" aria-labelledby="soil-heading">
            <h2 id="soil-heading" class="glass-panel__title">CoAgMET soil</h2>
            <dl class="metric-list metric-list--compact">
              <dt>Station</dt><dd>${escapeHtml(String(coag.station_name ?? coag.station_id ?? ''))}</dd>
              ${coag.soil_temp_5cm_f != null ? `<dt>Soil 5 cm</dt><dd>${coag.soil_temp_5cm_f}°F</dd>` : ''}
              ${coag.soil_temp_15cm_f != null ? `<dt>Soil 15 cm</dt><dd>${coag.soil_temp_15cm_f}°F</dd>` : ''}
              ${coag.soil_moisture_5cm != null ? `<dt>Moisture 5 cm</dt><dd>${escapeHtml(String(coag.soil_moisture_5cm))}</dd>` : ''}
              ${coag.eto_in != null ? `<dt>ET₀</dt><dd>${escapeHtml(String(coag.eto_in))}</dd>` : ''}
            </dl>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="coagmet-heading">Full agriculture section</button>
          </section>`);
  }

  if (snotel && Number(data.elevation_ft) >= 7000) {
    parts.push(`<section class="glass-panel" aria-labelledby="snow-intel-heading">
            <h2 id="snow-intel-heading" class="glass-panel__title">Snowpack</h2>
            <dl class="metric-list metric-list--compact">
              <dt>SNOTEL</dt><dd>${escapeHtml(String(snotel.station_name ?? snotel.station_id ?? ''))}${snotel.distance_km != null ? ` · ${snotel.distance_km} km` : ''}</dd>
              ${snotel.snow_depth_in != null ? `<dt>Depth</dt><dd>${escapeHtml(String(snotel.snow_depth_in))} in</dd>` : ''}
              ${snotel.swe_in != null ? `<dt>SWE</dt><dd>${escapeHtml(String(snotel.swe_in))} in</dd>` : ''}
              ${snotel.precipitation_24h_in != null ? `<dt>24h precip</dt><dd>${escapeHtml(String(snotel.precipitation_24h_in))} in</dd>` : ''}
            </dl>
            <button type="button" class="btn btn-link intel-jump" data-jump-to="snowpack-heading">Full snowpack section</button>
          </section>`);
  }

  parts.push(`<nav class="glass-panel glass-panel--nav" aria-label="Deep forecast sections">
      <h2 class="glass-panel__title">Deep forecast</h2>
      <ul class="intel-nav">
        <li><button type="button" class="intel-jump" data-jump-to="hourly-heading">48-hour hourly</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="daily-heading">10-day daily</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="alerts-heading">Alerts &amp; discussion</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="roads-heading">Roads &amp; passes</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="metar-heading">Aviation</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="aqi-heading">Air quality &amp; pollen</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="astronomy-heading">Astronomy</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="smoke-heading">Fire weather &amp; restrictions</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="ham-heading">Ham radio &amp; space weather</button></li>
        <li><button type="button" class="intel-jump" data-jump-to="links-heading">External tools</button></li>
      </ul>
    </nav>`);

  root.innerHTML = parts.join('\n');
  bindJumps(root, options.onJump);
  bindCamErrors(root);
}
