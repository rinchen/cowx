/**
 * Convert a human-readable name to a URL-safe slug.
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  if (typeof input !== 'string') {
    throw new TypeError('slugify expects a string');
  }

  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
