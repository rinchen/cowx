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
