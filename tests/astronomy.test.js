import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAstronomy,
  getMoonIllumination,
  getSunTimes,
  moonPhaseLabel,
  nextMoonPhases,
} from '../scripts/lib/astronomy.js';

describe('astronomy', () => {
  const plains = { lat: 39.7392, lon: -104.9903 }; // Denver area
  const highCountry = { lat: 39.1911, lon: -106.8175 }; // Aspen area
  const westernSlope = { lat: 39.0639, lon: -108.5506 }; // Grand Junction

  it('computes sunrise/sunset for multiple Colorado sites on a fixed date', () => {
    const date = new Date('2026-07-20T18:00:00Z');
    for (const site of [plains, highCountry, westernSlope]) {
      const times = getSunTimes(date, site.lat, site.lon);
      assert.ok(times.sunrise instanceof Date);
      assert.ok(times.sunset instanceof Date);
      assert.ok(times.dawn instanceof Date);
      assert.ok(times.dusk instanceof Date);
      assert.ok(times.sunset.getTime() > times.sunrise.getTime());
      assert.ok(times.dusk.getTime() > times.dawn.getTime());
    }
  });

  it('returns stable moon illumination and labels', () => {
    const fullish = getMoonIllumination(new Date('2026-07-29T12:00:00Z'));
    assert.ok(fullish.fraction > 0.9);
    assert.equal(moonPhaseLabel(0), 'New Moon');
    assert.equal(moonPhaseLabel(0.5), 'Full Moon');
    assert.equal(moonPhaseLabel(0.25), 'First Quarter');
  });

  it('buildAstronomy returns payload-shaped snapshot for each region', () => {
    const now = new Date('2026-07-20T22:00:00Z');
    for (const site of [plains, highCountry, westernSlope]) {
      const astro = buildAstronomy(site.lat, site.lon, now);
      assert.equal(astro.date, '2026-07-20');
      assert.ok(typeof astro.sunrise === 'string');
      assert.ok(typeof astro.sunset === 'string');
      assert.ok(astro.civil_twilight?.begin);
      assert.ok(astro.nautical_twilight?.end);
      assert.ok(astro.astronomical_twilight?.begin);
      assert.ok(Number(astro.day_length_s) > 40_000);
      assert.ok(astro.moon?.phase_label);
      assert.ok(Number(astro.moon?.illumination_pct) >= 0);
      assert.ok(Array.isArray(astro.next_phases));
      assert.ok(astro.next_phases.length >= 1);
    }
  });

  it('nextMoonPhases returns dated quarter names', () => {
    const phases = nextMoonPhases(new Date('2026-07-20T12:00:00Z'), 4);
    assert.ok(phases.length >= 2);
    for (const p of phases) {
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'].includes(p.name));
    }
  });
});
