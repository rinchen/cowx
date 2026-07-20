import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { resolveIpGeolocation } from '../public/js/geo.js';

const IPWHO = 'https://ipwho.is/';
const GEOJS = 'https://get.geojs.io/v1/ip/geo.json';

/** @type {typeof fetch | undefined} */
let originalFetch;

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
});

/**
 * @param {(url: string) => Response | Promise<Response>} handler
 */
function mockFetch(handler) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : String(input.url);
    return handler(url);
  };
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveIpGeolocation', () => {
  it('parses ipwho.is-shaped success responses', async () => {
    mockFetch((url) => {
      assert.equal(url, IPWHO);
      return jsonResponse({
        success: true,
        latitude: 39.7392,
        longitude: -104.9903,
      });
    });

    const result = await resolveIpGeolocation(1000);
    assert.deepEqual(result, {
      lat: 39.7392,
      lon: -104.9903,
      source: IPWHO,
    });
  });

  it('falls back to geojs when the first endpoint fails', async () => {
    mockFetch((url) => {
      if (url === IPWHO) return jsonResponse({ success: false, message: 'fail' });
      if (url === GEOJS) {
        return jsonResponse({
          latitude: '40.015',
          longitude: '-105.2705',
        });
      }
      return jsonResponse({}, 500);
    });

    const result = await resolveIpGeolocation(1000);
    assert.deepEqual(result, {
      lat: 40.015,
      lon: -105.2705,
      source: GEOJS,
    });
  });

  it('returns null when both endpoints fail', async () => {
    mockFetch(() => jsonResponse({ error: true }, 502));

    const result = await resolveIpGeolocation(1000);
    assert.equal(result, null);
  });

  it('rejects null latitude/longitude instead of coercing to 0', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        latitude: null,
        longitude: null,
      }),
    );

    const result = await resolveIpGeolocation(1000);
    assert.equal(result, null);
  });
});
