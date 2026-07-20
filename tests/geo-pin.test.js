import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { clearHyperlocalPin, getHyperlocalPin, setHyperlocalPin } from '../public/js/geo.js';

/** @type {Map<string, string>} */
let localStore;
/** @type {Map<string, string>} */
let sessionStore;

function installStorage() {
  localStore = new Map();
  sessionStore = new Map();
  const make = (store) => ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  globalThis.localStorage = make(localStore);
  globalThis.sessionStorage = make(sessionStore);
}

afterEach(() => {
  clearHyperlocalPin();
});

describe('hyperlocal pin persistence', () => {
  it('stores and reads Colorado pins', () => {
    installStorage();
    setHyperlocalPin({
      lat: 39.74,
      lon: -104.99,
      accuracy_m: 12,
      at: '2026-07-20T12:00:00.000Z',
      source: 'gps',
    });
    const pin = getHyperlocalPin();
    assert.ok(pin);
    assert.equal(pin.lat, 39.74);
    assert.equal(pin.source, 'gps');
  });

  it('rejects out-of-state pins on write and clears bad stored pins on read', () => {
    installStorage();
    setHyperlocalPin({
      lat: 40.7,
      lon: -74.0,
      accuracy_m: null,
      at: '2026-07-20T12:00:00.000Z',
      source: 'gps',
    });
    assert.equal(getHyperlocalPin(), null);

    localStore.set(
      'cowx:hyperlocalPin',
      JSON.stringify({
        lat: 41.5,
        lon: -87.6,
        accuracy_m: null,
        at: '2026-07-20T12:00:00.000Z',
        source: 'ip',
      }),
    );
    assert.equal(getHyperlocalPin(), null);
  });

  it('migrates sessionStorage pin into localStorage', () => {
    installStorage();
    sessionStore.set(
      'cowx:hyperlocalPin',
      JSON.stringify({
        lat: 40.015,
        lon: -105.27,
        accuracy_m: null,
        at: '2026-07-20T12:00:00.000Z',
        source: 'address',
        label: 'Boulder',
      }),
    );
    const pin = getHyperlocalPin();
    assert.ok(pin);
    assert.equal(pin.source, 'address');
    assert.ok(localStore.has('cowx:hyperlocalPin'));
    assert.equal(sessionStore.has('cowx:hyperlocalPin'), false);
  });
});
