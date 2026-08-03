/**
 * Shared HTTP helpers for fetch adapters.
 * Failure point: network / HTTP errors.
 * Fallback: caller handles null/throw; never swallow without status.
 */

import { Agent, setGlobalDispatcher } from 'undici';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Align TCP/TLS connect budget with typical adapter AbortController timeouts. */
const CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 0;
const RETRY_BACKOFFS_MS = [1000, 3000];

/** Query/header param names that must never appear in logs or meta.json. */
const SECRET_PARAM_RE = /^(?:api[_-]?key|access[_-]?token|token|key|auth|password|secret)$/i;

const TRANSIENT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

let longConnectInstalled = false;

/**
 * Install a process-wide undici Agent with a longer connect timeout.
 * Safe to call repeatedly; no-ops after the first successful install.
 */
export function ensureLongConnectTimeout() {
  if (longConnectInstalled) return;
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: CONNECT_TIMEOUT_MS },
    }),
  );
  longConnectInstalled = true;
}

// Prefer long connects for all fetch adapters in this process.
ensureLongConnectTimeout();

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
 * Covers query-like secret params plus Bearer / Authorization header values
 * that sometimes appear in upstream error bodies.
 * @param {unknown} message
 * @returns {string}
 */
export function sanitizeErrorMessage(message) {
  let s = String(message ?? '');
  s = s.replace(
    /([?&](?:api[_-]?key|access[_-]?token|token|key|auth|password|secret)=)[^&\s]*/gi,
    '$1[redacted]',
  );
  // Header-style secrets (X-API-Key, api-key, etc.)
  s = s.replace(
    /((?:X-)?API[_-]?Key|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;"']+/gi,
    '$1=[redacted]',
  );
  // Authorization: Bearer <token> | Authorization=<token>
  s = s.replace(/(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"']+/gi, '$1[redacted]');
  // Standalone Bearer tokens (JSON bodies, WWW-Authenticate echoes, etc.)
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-+=/]+/gi, '$1[redacted]');
  return s;
}

/**
 * Short cause suffix for network/abort failures (meta.json / logs).
 * @param {unknown} err
 * @returns {string}
 */
export function formatFetchErrorCause(err) {
  if (!(err instanceof Error)) return '';
  if (err.name === 'AbortError') return 'timeout';
  const cause = /** @type {{ code?: string, message?: string } | undefined} */ (err.cause);
  if (cause && typeof cause === 'object') {
    if (cause.code) return String(cause.code);
    if (cause.message) return sanitizeErrorMessage(String(cause.message).slice(0, 80));
  }
  return '';
}

/**
 * Collect error codes / names from an Error and its cause chain.
 * @param {unknown} err
 * @returns {string[]}
 */
function collectErrorCodes(err) {
  /** @type {string[]} */
  const codes = [];
  /** @type {unknown} */
  let cur = err;
  for (let i = 0; i < 5 && cur; i += 1) {
    if (cur instanceof Error) {
      if (cur.name) codes.push(cur.name);
      const c = /** @type {{ code?: string }} */ (cur);
      if (c.code) codes.push(String(c.code));
      const msg = cur.message || '';
      for (const code of TRANSIENT_CODES) {
        if (msg.includes(code)) codes.push(code);
      }
      if (/\btimeout\b/i.test(msg)) codes.push('timeout');
      cur = cur.cause;
    } else if (cur && typeof cur === 'object') {
      const o = /** @type {{ code?: string, message?: string, cause?: unknown }} */ (cur);
      if (o.code) codes.push(String(o.code));
      if (o.message) {
        for (const code of TRANSIENT_CODES) {
          if (o.message.includes(code)) codes.push(code);
        }
      }
      cur = o.cause;
    } else {
      break;
    }
  }
  return codes;
}

/**
 * True for connect/socket/abort failures worth retrying.
 * HTTP 4xx/5xx thrown by fetchJson are not transient.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTransientFetchError(err) {
  if (!(err instanceof Error)) return false;
  if (/^HTTP \d{3}\b/.test(err.message)) return false;
  const codes = collectErrorCodes(err);
  if (codes.includes('AbortError') || codes.includes('timeout')) return true;
  return codes.some((c) => TRANSIENT_CODES.has(c));
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, retries?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, ...init } = options;
  const maxAttempts = Math.max(1, 1 + Number(retries) || 0);
  /** @type {unknown} */
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < maxAttempts - 1 && isTransientFetchError(wrapFetchError(url, err));
      if (!canRetry) break;
      const backoff = RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)] ?? 1000;
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw wrapFetchError(url, lastErr);
}

/**
 * @param {string} url
 * @param {unknown} err
 * @returns {Error}
 */
function wrapFetchError(url, err) {
  const safeUrl = sanitizeUrlForError(url);
  const base = err instanceof Error ? err.message : String(err);
  const cause = formatFetchErrorCause(err);
  const msg = cause ? `${base} (${cause}) for ${safeUrl}` : `${base} for ${safeUrl}`;
  const wrapped = new Error(sanitizeErrorMessage(msg));
  if (err instanceof Error) {
    wrapped.cause = err;
    if (err.name === 'AbortError') wrapped.name = 'AbortError';
  }
  return wrapped;
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, retries?: number }} [options]
 * @returns {Promise<unknown>}
 */
export async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const safeUrl = sanitizeUrlForError(url);
    const snippet = sanitizeErrorMessage(body.slice(0, 200));
    throw new Error(`HTTP ${res.status} for ${safeUrl}: ${snippet}`);
  }
  return res.json();
}

export const NWS_USER_AGENT = 'COWX/1.0 (https://github.com/rinchen/cowx; colorado-weather)';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log with secret redaction (safe for Action logs).
 * @param {'log'|'warn'|'error'} level
 * @param {...unknown} args
 */
export function logSafe(level, ...args) {
  const line = args.map((a) => sanitizeErrorMessage(a instanceof Error ? a.message : a)).join(' ');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
