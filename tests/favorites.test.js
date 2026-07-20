import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  getFavorites,
  getLastLocation,
  getPreferredSlug,
  isFavorite,
  setLastLocation,
  toggleFavorite,
} from '../public/js/favorites.js';

/** Minimal localStorage shim for Node tests. */
function installStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  return store;
}

afterEach(() => {
  try {
    globalThis.localStorage?.clear?.();
  } catch {
    /* ignore */
  }
});

describe('favorites', () => {
  it('toggles favorites and reports preferred slug', () => {
    installStorage();
    assert.equal(isFavorite('denver'), false);
    assert.equal(toggleFavorite('denver'), true);
    assert.equal(isFavorite('denver'), true);
    assert.deepEqual(getFavorites(), ['denver']);
    assert.equal(toggleFavorite('denver'), false);
    assert.equal(getPreferredSlug(), null);

    setLastLocation('boulder');
    assert.equal(getLastLocation(), 'boulder');
    assert.equal(getPreferredSlug(), 'boulder');

    toggleFavorite('denver');
    assert.equal(getPreferredSlug(), 'boulder');
  });
});
