import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countyKeyFromFips,
  countyKeysForAlertProps,
  countyKeysFromAreaDesc,
  countyKeysFromGeocode,
  normalizeCountyKey,
} from '../public/js/co-counties.js';

describe('co-counties normalize', () => {
  it('strips County and , CO suffixes', () => {
    assert.equal(normalizeCountyKey('Denver, CO'), 'denver');
    assert.equal(normalizeCountyKey('Boulder County'), 'boulder');
    assert.equal(normalizeCountyKey('El Paso, Colorado'), 'el paso');
  });
});

describe('co-counties areaDesc + geocode', () => {
  it('parses simple county lists with state suffix', () => {
    const keys = countyKeysFromAreaDesc('Adams, CO; Western Arapahoe, CO; Denver, CO');
    assert.ok(keys.includes('adams'));
    assert.ok(keys.includes('denver'));
    // "Western Arapahoe" is not an exact county token; word scan still finds Arapahoe.
    assert.ok(keys.includes('arapahoe'));
  });

  it('finds Denver inside zone-style areaDesc phrases', () => {
    const keys = countyKeysFromAreaDesc(
      'North Douglas County Below 6000 Feet/Denver/West Adams and Arapahoe Counties/East Broomfield County',
    );
    assert.ok(keys.includes('denver'));
    assert.ok(keys.includes('douglas'));
    assert.ok(keys.includes('adams'));
    assert.ok(keys.includes('arapahoe'));
    assert.ok(keys.includes('broomfield'));
  });

  it('prefers rio grande over grand when both appear', () => {
    const keys = countyKeysFromAreaDesc('Rio Grande County');
    assert.ok(keys.includes('rio grande'));
  });

  it('maps SAME and COC UGC to county keys; ignores COZ zones', () => {
    const keys = countyKeysFromGeocode({
      SAME: ['008031', '408005'],
      UGC: ['COC031', 'COZ041'],
    });
    assert.deepEqual(keys.sort(), ['denver']);
    assert.equal(countyKeyFromFips('008031'), 'denver');
    assert.equal(countyKeyFromFips('031'), 'denver');
  });

  it('unions areaDesc and geocode keys for alert props', () => {
    const keys = countyKeysForAlertProps({
      areaDesc: 'Pueblo Vicinity',
      geocode: { SAME: ['008101'], UGC: ['COZ086'] },
    });
    assert.ok(keys.includes('pueblo'));
  });
});
