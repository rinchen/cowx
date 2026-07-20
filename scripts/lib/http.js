/**
 * Shared HTTP helpers for fetch adapters.
 * Failure point: network / HTTP errors.
 * Fallback: caller handles null/throw; never swallow without status.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/** Query/header param names that must never appear in logs or meta.json. */
const SECRET_PARAM_RE = /^(?:api[_-]?key|access[_-]?token|token|key|auth|password|secret)$/i;

/**
 * Redact secret query params from a URL for error messages / meta.json.
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrlForError(url) {
  const raw = String(url ?? '');
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_PARAM_RE.test(key)) {
        u.searchParams.set(key, '[redacted]');
      }
    }
    return u.toString();
  } catch {
    return raw.replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|key|auth|password|secret)=)[^&\s]*/gi,
      '$1[redacted]',
    );
  }
}

/**
 * Redact secret-bearing substrings from an arbitrary error message.
 * @param {unknown} message
 * @returns {string}
 */
export function sanitizeErrorMessage(message) {
  return String(message ?? '').replace(
    /([?&](?:api[_-]?key|access[_-]?token|token|key|auth|password|secret)=)[^&\s]*/gi,
    '$1[redacted]',
  );
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @returns {Promise<unknown>}
 */
export async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const safeUrl = sanitizeUrlForError(url);
    throw new Error(`HTTP ${res.status} for ${safeUrl}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export const NWS_USER_AGENT = 'COWX/1.0 (https://github.com/rinchen/cowx; colorado-weather)';
