/**
 * NOAA / CSU CIRA deep-link helpers (used from External tools footer).
 * Official sites often block iframes; we link out instead of embedding.
 */

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
      ? `https://radar.weather.gov/?settings=v1_%7B%22lat%22%3A${la}%2C%22lon%22%3A${lo}%2C%22zoom%22%3A7%7D`
      : 'https://radar.weather.gov/',
    nwsForecast: hasCoords
      ? `https://forecast.weather.gov/MapClick.php?lat=${la}&lon=${lo}`
      : 'https://www.weather.gov/',
    ciraSlider:
      'https://rammb-slider.cira.colostate.edu/?sat=goes-16&sec=conus&p%5B0%5D=geocolor&x=-104.9903&y=39.7392&z=4',
    rainviewer: hasCoords
      ? `https://www.rainviewer.com/map.html?loc=${la},${lo},7`
      : 'https://www.rainviewer.com/map.html',
  };
}
