import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windCompassHtml, windCellHtml, windDirLabel } from '../public/js/wind.js';

describe('windDirLabel', () => {
  it('labels cardinals and degrees', () => {
    assert.equal(windDirLabel(0), 'N (0°)');
    assert.equal(windDirLabel(22), 'NNE (22°)');
    assert.equal(windDirLabel(180), 'S (180°)');
    assert.equal(windDirLabel(null), null);
    assert.equal(windDirLabel(undefined), null);
  });
});

describe('windCompassHtml', () => {
  it('returns empty for missing deg', () => {
    assert.equal(windCompassHtml(null), '');
    assert.equal(windCompassHtml(undefined), '');
    assert.equal(windCompassHtml(Number.NaN), '');
  });

  it('rotates arrow for meteorological from-direction', () => {
    const html = windCompassHtml(90, { size: 28 });
    assert.match(html, /aria-label="Wind from E \(90°\)"/);
    assert.match(html, /transform="rotate\(90\.0 16 16\)"/);
    assert.match(html, /class="wind-compass"/);
  });

  it('normalizes negative and large degrees', () => {
    const html = windCompassHtml(-45);
    assert.match(html, /rotate\(315\.0 16 16\)/);
  });
});

describe('windCellHtml', () => {
  it('combines compass and speed', () => {
    const html = windCellHtml(0, 12);
    assert.match(html, /wind-compass/);
    assert.match(html, /12 mph/);
  });

  it('shows em dash when both missing', () => {
    assert.equal(windCellHtml(null, null), '—');
  });

  it('shows speed alone without direction', () => {
    assert.equal(windCellHtml(null, 8), '8 mph');
  });
});
