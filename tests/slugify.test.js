import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { slugify } from '../scripts/lib/slugify.js';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slugify('Denver'), 'denver');
    assert.equal(slugify('Fort Collins'), 'fort-collins');
  });

  it('strips punctuation and collapses separators', () => {
    assert.equal(slugify('  Steamboat Springs, CO  '), 'steamboat-springs-co');
    assert.equal(slugify('Mount Elbert (14er)'), 'mount-elbert-14er');
  });

  it('removes diacritics', () => {
    assert.equal(slugify('Cañon City'), 'canon-city');
  });

  it('throws for non-string input', () => {
    assert.throws(() => slugify(123), TypeError);
  });
});
