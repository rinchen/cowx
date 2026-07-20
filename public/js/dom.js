/**
 * Shared DOM / string helpers for the static client.
 */

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Allow only https: URLs for href/src. Rejects javascript:, data:, etc.
 * @param {unknown} u
 * @returns {string | null}
 */
export function safeHttpsUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const parsed = new URL(u.trim());
    if (parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Allow http: or https: for official offsite verify links (some county sites are http-only).
 * Rejects javascript:, data:, etc.
 * @param {unknown} u
 * @returns {string | null}
 */
export function safeExternalUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const parsed = new URL(u.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Scroll to a section and open enclosing details when needed.
 * @param {string} id
 */
export function jumpToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  if (el instanceof HTMLElement) {
    const details = el.closest('details');
    if (details && !details.open) details.open = true;
    el.focus?.({ preventScroll: true });
  }
}
