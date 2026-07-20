import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imageryUrls } from '../public/js/imagery.js';

describe('imageryUrls', () => {
  it('builds lat/lon-aware NOAA and RainViewer links', () => {
    const urls = imageryUrls(39.74, -104.99);
    assert.match(urls.nwsRadar, /radar\.weather\.gov/);
    assert.match(urls.nwsForecast, /lat=39\.74/);
    assert.match(urls.nwsForecast, /lon=-104\.99/);
    assert.match(urls.rainviewer, /39\.74,-104\.99/);
    assert.match(urls.ciraSlider, /rammb-slider\.cira\.colostate\.edu/);
  });

  it('falls back without coordinates', () => {
    const urls = imageryUrls(null, null);
    assert.equal(urls.nwsRadar, 'https://radar.weather.gov/');
    assert.equal(urls.rainviewer, 'https://www.rainviewer.com/map.html');
  });
});
