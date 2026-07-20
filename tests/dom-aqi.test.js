import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aqiCategory, aqiMarkerColor, pickAqi } from '../public/js/aqi.js';
import { escapeHtml, safeHttpsUrl, safeExternalUrl } from '../public/js/dom.js';
import { wmoLabel as clientWmo } from '../public/js/wmo.js';
import { wmoLabel as fetchWmo } from '../scripts/lib/wmo.js';

describe('dom helpers', () => {
  it('escapeHtml escapes markup', () => {
    assert.equal(escapeHtml('<script>"x"&'), '&lt;script&gt;&quot;x&quot;&amp;');
  });

  it('safeHttpsUrl allows https only', () => {
    assert.equal(safeHttpsUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeHttpsUrl('http://example.com/a'), null);
    assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
    assert.equal(safeHttpsUrl(''), null);
  });

  it('safeExternalUrl allows http and https', () => {
    assert.equal(safeExternalUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeExternalUrl('http://example.com/a'), 'http://example.com/a');
    assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  });
});

describe('aqi helpers', () => {
  it('pickAqi prefers AirNow over PurpleAir', () => {
    const picked = pickAqi({
      airnow: { aqi: 40 },
      purpleair: { aqi_pm25: 90 },
      openmeteo_aq: { us_aqi: 120 },
    });
    assert.equal(picked.aqi, 40);
    assert.equal(picked.source, 'AirNow');
  });

  it('aqiCategory maps breakpoints', () => {
    assert.equal(aqiCategory(10).label, 'Good');
    assert.equal(aqiCategory(250).label, 'Very unhealthy');
    assert.equal(aqiCategory(null).label, 'Unavailable');
  });

  it('aqiMarkerColor returns stroke/fill', () => {
    const c = aqiMarkerColor(75);
    assert.ok(c.stroke && c.fill);
  });
});

describe('wmo label parity', () => {
  it('client and fetch labels match for shared codes', () => {
    for (const code of [0, 48, 95, 99]) {
      assert.equal(clientWmo(code), fetchWmo(code));
    }
    assert.equal(clientWmo(48), 'Depositing Rime Fog');
  });
});
