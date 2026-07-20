/**
 * Shared parsing helpers for adapter payloads.
 */

/**
 * Coerce a value to a finite number, or null.
 * @param {unknown} v
 * @returns {number | null}
 */
export function toFiniteNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
