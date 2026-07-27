import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  wmoToMeteoconSlug,
  wmoLabel,
  weatherIconHtml,
  meteoconIconHtml,
  metricValueWithIcon,
  pressureTrendIconHtml,
  isDaytime,
} from '../public/js/icons.js';

describe('wmoToMeteoconSlug', () => {
  it('maps clear and rain with day/night', () => {
    assert.equal(wmoToMeteoconSlug(0, true), 'clear-day');
    assert.equal(wmoToMeteoconSlug(0, false), 'clear-night');
    assert.equal(wmoToMeteoconSlug(61, true), 'rain');
    assert.equal(wmoToMeteoconSlug(95, true), 'thunderstorms');
  });
});

describe('weatherIconHtml', () => {
  it('resolves vendored docs-layout paths from this module', () => {
    const html = weatherIconHtml(0, { isDay: true, alt: 'Clear' });
    assert.match(html, /src="[^"]*\/img\/meteocons\/(svg|svg-static)\/fill\/clear-day\.svg"/);
    assert.match(html, /alt="Clear"/);
  });
});

describe('meteoconIconHtml', () => {
  it('resolves allowlisted metric glyphs from the meteocons tree', () => {
    for (const slug of [
      'barometer',
      'humidity',
      'uv-index',
      'thermometer-water',
      'umbrella',
      'raindrop',
      'cloudy',
    ]) {
      const html = meteoconIconHtml(slug, { alt: slug });
      assert.match(
        html,
        new RegExp(`src="[^"]*/img/meteocons/(svg|svg-static)/fill/${slug}\\.svg"`),
      );
    }
  });

  it('rejects unknown slugs', () => {
    assert.equal(meteoconIconHtml('not-a-real-icon'), '');
  });
});

describe('metricValueWithIcon', () => {
  it('wraps escaped text with a decorative glyph', () => {
    const html = metricValueWithIcon('humidity', '42%');
    assert.match(html ?? '', /humidity\.svg/);
    assert.match(html ?? '', /metric-with-icon__text">42%/);
    assert.match(html ?? '', /alt=""/);
  });

  it('returns null for empty text', () => {
    assert.equal(metricValueWithIcon('humidity', null), null);
    assert.equal(metricValueWithIcon('humidity', ''), null);
  });
});

describe('pressureTrendIconHtml', () => {
  it('renders Weather Icons arrows with spoken alt text', () => {
    const up = pressureTrendIconHtml('rising');
    assert.match(up, /wi-direction-up\.svg/);
    assert.match(up, /alt="Rising"/);
    const down = pressureTrendIconHtml('falling');
    assert.match(down, /wi-direction-down\.svg/);
    assert.match(down, /alt="Falling"/);
    const flat = pressureTrendIconHtml('flat');
    assert.match(flat, /pressure-flat\.svg/);
    assert.match(flat, /alt="Flat"/);
  });

  it('returns empty for missing trend', () => {
    assert.equal(pressureTrendIconHtml(null), '');
    assert.equal(pressureTrendIconHtml(undefined), '');
  });
});

describe('wmoLabel', () => {
  it('labels common codes', () => {
    assert.equal(wmoLabel(0), 'Clear');
    assert.equal(wmoLabel(95), 'Thunderstorm');
  });
});

describe('isDaytime', () => {
  it('uses Denver-local ordinals for offset-less Open-Meteo ISO', () => {
    const sunrises = ['2026-07-22T05:45'];
    const sunsets = ['2026-07-22T20:15'];
    assert.equal(isDaytime('2026-07-22T12:00', sunrises, sunsets), true);
    assert.equal(isDaytime('2026-07-22T02:00', sunrises, sunsets), false);
    assert.equal(isDaytime('2026-07-22T21:00', sunrises, sunsets), false);
  });

  it('falls back to coarse 6–20 Denver hour without sunrise arrays', () => {
    assert.equal(isDaytime('2026-07-22T12:00', null, null), true);
    assert.equal(isDaytime('2026-07-22T03:00', [], []), false);
  });
});
