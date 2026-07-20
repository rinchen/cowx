import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPressureDip,
  mbToInHg,
  meteogramHtml,
  sparklineHtml,
} from '../public/js/sparkline.js';
import { selectRadarFrames, radarTileUrl } from '../public/js/radar-loop.js';
import { estimateRfComms } from '../scripts/lib/rf-comms.js';
import { parseCameras, parseRwisGeoJson } from '../scripts/fetch/adapters/cdot.js';
import { parseNearbyStations } from '../scripts/fetch/adapters/cwop.js';

describe('sparkline / meteogram', () => {
  it('renders a sparkline for finite series', () => {
    const html = sparklineHtml([60, 62, 61, 65]);
    assert.match(html, /<svg/);
    assert.match(html, /polyline/);
  });

  it('detects rapid pressure dips in inHg', () => {
    const series = [30.1, 30.08, 30.05, 29.98, 29.9];
    const dip = detectPressureDip(series, { window: 3, threshold: 0.06 });
    assert.equal(dip.dip, true);
    assert.ok(dip.delta >= 0.06);
  });

  it('converts mb to inHg', () => {
    assert.ok(Math.abs(mbToInHg(1013.25) - 29.92) < 0.05);
  });

  it('builds meteogram with secondary series', () => {
    const html = meteogramHtml([5, 8, 12, 10], {
      secondary: [10, 14, 20, 18],
      label: 'Wind',
    });
    assert.match(html, /aria-label="Wind"/);
    assert.match(html, /polyline/);
  });
});

describe('radar-loop helpers', () => {
  it('selects frames within the last 2 hours', () => {
    const now = 1_700_000_000;
    const data = {
      radar: {
        past: [
          { time: now - 3 * 3600, path: '/old' },
          { time: now - 90 * 60, path: '/a' },
          { time: now - 30 * 60, path: '/b' },
          { time: now, path: '/c' },
        ],
        nowcast: [{ time: now + 600, path: '/n' }],
      },
    };
    const frames = selectRadarFrames(data, 2);
    assert.equal(frames.length, 4);
    assert.equal(frames[0].path, '/a');
    assert.match(radarTileUrl('/a'), /tilecache\.rainviewer\.com\/a\/256/);
  });
});

describe('rf-comms', () => {
  it('flags ducting when 850 mb is warmer than surface', () => {
    // 20°C = 68°F; surface 55°F → inversion
    const r = estimateRfComms({ temp_f: 55, wind_speed_mph: 5 }, 20, 5000);
    assert.equal(r?.status, 'ducting_likely');
  });

  it('flags poor when winds are strong', () => {
    const r = estimateRfComms({ temp_f: 70, wind_gust_mph: 40 }, 10, 5000);
    assert.equal(r?.status, 'poor');
  });
});

describe('cdot parsers', () => {
  it('parses camera inventory with preview URLs', () => {
    const cams = parseCameras([
      {
        id: 1,
        public: true,
        active: true,
        name: 'Test Cam',
        location: { latitude: 39.7, longitude: -104.9 },
        views: [{ videoPreviewUrl: 'https://example.com/cam.jpg' }],
      },
    ]);
    assert.equal(cams.length, 1);
    assert.equal(cams[0].imageUrl, 'https://example.com/cam.jpg');
  });

  it('parses RWIS geojson features', () => {
    const stations = parseRwisGeoJson({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-105.2, 39.9] },
          properties: {
            ws_deviceid: '8278',
            ws_commonname: 'Test RWIS',
            ws_latitude: 39.9,
            ws_longitude: -105.2,
            ws_essairtemp: 47,
            surfacesensor_esssurfacetempera: 57,
            surfacesensor_rwissurfacestatus: 'Dry',
          },
        },
      ],
    });
    assert.equal(stations.length, 1);
    assert.equal(stations[0].air_temp_f, 47);
    assert.equal(stations[0].surface_status, 'Dry');
  });
});

describe('cwop parser', () => {
  it('parses aprs.me nearby payload', () => {
    const stations = parseNearbyStations({
      data: [
        {
          callsign: 'N0TEST-1',
          position: { lat: 40.1, lon: -105.1 },
          weather: { temperature: 72, humidity: 30, wind_speed: 5 },
          last_report: '2026-07-20T12:00:00Z',
        },
      ],
    });
    assert.equal(stations.length, 1);
    assert.equal(stations[0].callsign, 'N0TEST-1');
    assert.equal(stations[0].temp_f, 72);
  });
});
