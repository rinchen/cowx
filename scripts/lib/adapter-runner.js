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
