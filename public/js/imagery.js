/**
 * NOAA / CSU CIRA imagery panels with click-throughs.
 * Embeds that block framing fall back to CTA cards (no dead iframes).
 */

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
 * @param {number | null | undefined} lat
 * @param {number | null | undefined} lon
 * @returns {{ nwsRadar: string, nwsForecast: string, ciraSlider: string, rainviewer: string }}
 */
export function imageryUrls(lat, lon) {
  const hasCoords =
    lat != null && lon != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
  const la = Number(lat);
  const lo = Number(lon);
  return {
    nwsRadar: hasCoords
      ? `https://radar.weather.gov/?settings=v1_%7B%22lat%22%3A${la}%2C%22lon%22%3A${lo}%2C%22zoom%22%3A8%7D`
      : 'https://radar.weather.gov/',
    nwsForecast: hasCoords
      ? `https://forecast.weather.gov/MapClick.php?lat=${la}&lon=${lo}`
      : 'https://www.weather.gov/',
    ciraSlider:
      'https://rammb-slider.cira.colostate.edu/?sat=goes-16&sec=conus&p%5B0%5D=geocolor&x=-104.9903&y=39.7392&z=4',
    rainviewer: hasCoords
      ? `https://www.rainviewer.com/map.html?loc=${la},${lo},8`
      : 'https://www.rainviewer.com/map.html',
  };
}

/**
 * @param {HTMLElement} parent
 * @param {{ lat?: number | null, lon?: number | null, name?: string, links?: Record<string, string | null | undefined> }} opts
 */
export function renderImagerySection(parent, opts) {
  const urls = imageryUrls(opts.lat, opts.lon);
  const links = opts.links ?? {};

  const section = document.createElement('section');
  section.className = 'imagery-section';
  section.setAttribute('aria-labelledby', 'imagery-heading');
  section.innerHTML = `
    <h2 id="imagery-heading">Radar &amp; satellite</h2>
    <p class="imagery-lead">
      Live RainViewer tiles are on the map below. Open NOAA and CSU CIRA products for official
      loops and full-screen analysis (many of those sites block in-page embeds).
    </p>
    <div class="imagery-grid">
      <article class="imagery-card">
        <h3>NOAA / NWS radar</h3>
        <p>Interactive NEXRAD from the National Weather Service, centered near this location.</p>
        <a class="btn btn-primary" href="${escapeHtml(urls.nwsRadar)}" target="_blank" rel="noopener noreferrer">Open radar.weather.gov</a>
        <a class="btn btn-secondary" href="${escapeHtml(links.nws_forecast ?? urls.nwsForecast)}" target="_blank" rel="noopener noreferrer">NWS point forecast</a>
      </article>
      <article class="imagery-card">
        <h3>CSU CIRA GOES satellite</h3>
        <p>RAMMB/CIRA SLIDER — GOES Geocolor for the CONUS region (Colorado State University).</p>
        <a class="btn btn-primary" href="${escapeHtml(urls.ciraSlider)}" target="_blank" rel="noopener noreferrer">Open CIRA SLIDER</a>
      </article>
      <article class="imagery-card">
        <h3>RainViewer</h3>
        <p>Same radar source as the map overlay, full-screen with animation controls.</p>
        <a class="btn btn-primary" href="${escapeHtml(links.rainviewer ?? urls.rainviewer)}" target="_blank" rel="noopener noreferrer">Open RainViewer map</a>
      </article>
    </div>
  `;
  parent.appendChild(section);
}
