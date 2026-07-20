const KEY_FAVORITES = 'cowx:favorites';
const KEY_LAST_LOCATION = 'cowx:lastLocation';

/**
 * @returns {string[]}
 */
export function getFavorites() {
  try {
    const raw = localStorage.getItem(KEY_FAVORITES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isFavorite(slug) {
  return getFavorites().includes(slug);
}

/**
 * @param {string} slug
 * @returns {boolean} new favorite state
 */
export function toggleFavorite(slug) {
  const set = new Set(getFavorites());
  if (set.has(slug)) {
    set.delete(slug);
  } else {
    set.add(slug);
  }
  localStorage.setItem(KEY_FAVORITES, JSON.stringify([...set]));
  return set.has(slug);
}

/**
 * @returns {string | null}
 */
export function getLastLocation() {
  try {
    return localStorage.getItem(KEY_LAST_LOCATION);
  } catch {
    return null;
  }
}

/**
 * @param {string} slug
 */
export function setLastLocation(slug) {
  try {
    localStorage.setItem(KEY_LAST_LOCATION, slug);
  } catch {
    /* quota or private mode — non-fatal */
  }
}

/**
 * Resolve slug from stored preferences: last location, then first favorite.
 * @returns {string | null}
 */
export function getPreferredSlug() {
  const last = getLastLocation();
  if (last) return last;

  const favorites = getFavorites();
  return favorites.length > 0 ? favorites[0] : null;
}
