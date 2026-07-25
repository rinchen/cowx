import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wmoToMeteoconSlug, wmoLabel, weatherIconHtml, isDaytime } from '../public/js/icons.js';

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
