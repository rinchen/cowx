/**
 * Pure helpers for Check Stale Data's notify-tier recovery wait.
 * A Discord page should mean mitigations failed — not that a delayed cron
 * overlapped with an in-flight Update Weather that is about to land.
 */

/**
 * @param {unknown} meta
 * @returns {string}
 */
export function parseGeneratedAt(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const v =
    /** @type {{ generatedAt?: unknown, updated_at?: unknown }} */ (meta).generatedAt ??
    /** @type {{ updated_at?: unknown }} */ (meta).updated_at;
  return v == null ? '' : String(v);
}

/**
 * @param {string} iso
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function ageMinutesFromIso(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 60000);
}

/**
 * Recovered when live age drops below the quiet self-heal tier, or when
 * generatedAt advances past the baseline that triggered the notify tier.
 *
 * @param {{
 *   generatedAt: string,
 *   ageMinutes: number|null,
 *   baselineGeneratedAt?: string,
 *   recoveredMaxAgeMinutes: number,
 * }} opts
 * @returns {boolean}
 */
export function liveMetaRecovered({
  generatedAt,
  ageMinutes,
  baselineGeneratedAt = '',
  recoveredMaxAgeMinutes,
}) {
  if (Number.isFinite(ageMinutes) && ageMinutes < recoveredMaxAgeMinutes) {
    return true;
  }
  if (baselineGeneratedAt && generatedAt) {
    const next = Date.parse(generatedAt);
    const baseline = Date.parse(baselineGeneratedAt);
    if (Number.isFinite(next) && Number.isFinite(baseline) && next > baseline) {
      return true;
    }
  }
  return false;
}

/**
 * Append a cache-buster so GitHub Pages (max-age=600) does not keep serving
 * the stale meta.json the watchdog is trying to observe.
 *
 * @param {string} url
 * @param {number} [nowMs]
 * @returns {string}
 */
export function cacheBustLiveMetaUrl(url, nowMs = Date.now()) {
  const parsed = new URL(url);
  parsed.searchParams.set('cowx_cb', String(nowMs));
  return parsed.toString();
}

/**
 * Suppress notify-tier alerts when Update Weather is still working or just
 * finished. A successful fetch+deploy can complete in the last seconds of the
 * wait window while the CDN has not been observed yet (run 34776810979).
 *
 * @param {{
 *   inProgressCount?: number,
 *   queuedCount?: number,
 *   latestSuccessCompletedAt?: string,
 *   nowMs?: number,
 *   recentSuccessGraceMinutes?: number,
 * }} [opts]
 * @returns {boolean}
 */
export function updateWeatherMitigationActive({
  inProgressCount = 0,
  queuedCount = 0,
  latestSuccessCompletedAt = '',
  nowMs = Date.now(),
  recentSuccessGraceMinutes = 10,
} = {}) {
  if (Number(inProgressCount) > 0 || Number(queuedCount) > 0) return true;
  if (!latestSuccessCompletedAt) return false;
  const completed = Date.parse(latestSuccessCompletedAt);
  const graceMs = Number(recentSuccessGraceMinutes) * 60_000;
  if (!Number.isFinite(completed) || !Number.isFinite(graceMs) || graceMs <= 0) {
    return false;
  }
  const ageMs = nowMs - completed;
  return ageMs >= 0 && ageMs < graceMs;
}
