/**
 * Isolate adapter failures so one throw cannot abort the rest of the fetch job.
 */

import { sanitizeErrorMessage } from './http.js';

/**
 * @typedef {{
 *   status: string,
 *   bySlug: Map<string, unknown>,
 *   calls?: number,
 *   error?: string,
 *   [key: string]: unknown,
 * }} AdapterResult
 */

/**
 * @param {{ slug: string }[]} locations
 * @returns {Map<string, null>}
 */
export function emptyBySlug(locations) {
  /** @type {Map<string, null>} */
  const bySlug = new Map();
  for (const loc of locations) bySlug.set(loc.slug, null);
  return bySlug;
}

/**
 * @param {{ slug: string }[]} locations
 * @param {string} error
 * @returns {AdapterResult}
 */
export function skippedResult(locations, error) {
  return {
    status: 'skipped',
    bySlug: emptyBySlug(locations),
    calls: 0,
    error,
  };
}

/**
 * Coverage-based status for adapters that assign 0..N of locations.
 * @param {Map<string, unknown>} bySlug
 * @param {number} locationCount
 * @param {{ minOk?: number, emptyError?: string }} [opts]
 * @returns {{ status: string, error?: string }}
 */
export function coverageStatus(bySlug, locationCount, opts = {}) {
  if (bySlug.size === 0) {
    return {
      status: locationCount === 0 ? 'ok' : 'partial',
      error: opts.emptyError ?? 'no locations matched',
    };
  }
  if (bySlug.size >= locationCount) {
    return { status: 'ok' };
  }
  return {
    status: 'partial',
    error: `coverage ${bySlug.size}/${Math.max(locationCount, 1)}`,
  };
}

/**
 * @param {() => Promise<AdapterResult>} fn
 * @returns {Promise<AdapterResult>}
 */
export async function runAdapterSafely(fn) {
  try {
    const result = await fn();
    if (!result.bySlug) result.bySlug = new Map();
    if (result.error) {
      result.error = sanitizeErrorMessage(result.error);
    }
    return result;
  } catch (err) {
    return {
      status: 'error',
      bySlug: new Map(),
      calls: 0,
      error: sanitizeErrorMessage(err instanceof Error ? err.message : err),
    };
  }
}
