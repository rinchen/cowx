/**
 * Heuristic HF band conditions and Colorado aurora chance from SFI + Kp.
 * Not a real-time MUF / ionosonde product — label as estimate in UI.
 */

/** @typedef {'poor' | 'fair' | 'good' | 'excellent'} HfRating */
/** @typedef {'unlikely' | 'possible' | 'likely'} AuroraChance */

export const HF_DISCLAIMER =
  'Heuristic from SFI/Kp — not a real-time MUF product. Check SWPC / prop maps for openings.';

export const HF_BANDS = /** @type {const} */ (['80m', '40m', '20m', '15m', '10m', '6m']);

/**
 * Map a numeric score 0–3 to a rating label.
 * @param {number} score
 * @returns {HfRating}
 */
export function scoreToRating(score) {
  if (score >= 3) return 'excellent';
  if (score >= 2) return 'good';
  if (score >= 1) return 'fair';
  return 'poor';
}

/**
 * Flux tier 0–3 from F10.7 cm solar flux index.
 * @param {number} sfi
 * @returns {number}
 */
export function fluxTier(sfi) {
  if (sfi >= 180) return 3;
  if (sfi >= 130) return 2;
  if (sfi >= 90) return 1;
  return 0;
}

/**
 * Geomagnetic drag 0–3 from planetary Kp.
 * @param {number} kp
 * @returns {number}
 */
export function kpDrag(kp) {
  if (kp >= 7) return 3;
  if (kp >= 5) return 2;
  if (kp >= 3) return 1;
  return 0;
}

/**
 * Base day/night scores (before flux boost / Kp drag) for each band.
 * Higher = better. N0NBH-style: low bands favor night; high bands favor day + flux.
 * @type {Record<string, { day: number, night: number, fluxWeight: number }>}
 */
const BAND_BASE = {
  '80m': { day: 1, night: 3, fluxWeight: 0 },
  '40m': { day: 2, night: 3, fluxWeight: 0 },
  '20m': { day: 2, night: 1, fluxWeight: 1 },
  '15m': { day: 1, night: 0, fluxWeight: 2 },
  '10m': { day: 0, night: 0, fluxWeight: 2 },
  '6m': { day: 0, night: 0, fluxWeight: 1 },
};

/**
 * N0NBH-style day/night band ratings from solar flux and planetary Kp.
 * @param {number | null | undefined} sfi — F10.7 cm flux
 * @param {number | null | undefined} kp — planetary Kp
 * @returns {{
 *   disclaimer: string,
 *   day: Record<string, HfRating>,
 *   night: Record<string, HfRating>,
 * } | null}
 */
export function estimateHfConditions(sfi, kp) {
  if (sfi == null || !Number.isFinite(Number(sfi)) || kp == null || !Number.isFinite(Number(kp))) {
    return null;
  }

  const flux = Number(sfi);
  const k = Math.max(0, Math.min(9, Number(kp)));
  const ft = fluxTier(flux);
  const drag = kpDrag(k);

  /** @type {Record<string, HfRating>} */
  const day = {};
  /** @type {Record<string, HfRating>} */
  const night = {};

  for (const band of HF_BANDS) {
    const cfg = BAND_BASE[band];
    const fluxBoost = Math.min(
      2,
      Math.floor((ft * cfg.fluxWeight) / 2) + (ft >= 2 && cfg.fluxWeight > 0 ? 1 : 0),
    );
    let dayScore = cfg.day + fluxBoost - drag;
    let nightScore = cfg.night + Math.min(1, fluxBoost) - drag;
    if (k >= 8) {
      dayScore = 0;
      nightScore = 0;
    }
    day[band] = scoreToRating(Math.max(0, Math.min(3, dayScore)));
    night[band] = scoreToRating(Math.max(0, Math.min(3, nightScore)));
  }

  return { disclaimer: HF_DISCLAIMER, day, night };
}

/**
 * Mid-latitude Colorado aurora visibility heuristic from planetary Kp.
 * @param {number | null | undefined} kp
 * @returns {{ chance: AuroraChance, detail: string } | null}
 */
export function estimateAuroraColorado(kp) {
  if (kp == null || !Number.isFinite(Number(kp))) return null;
  const k = Number(kp);
  if (k >= 7) {
    return {
      chance: 'likely',
      detail: `Kp ${k.toFixed(1)} — aurora possible across Colorado (northern horizon; estimate).`,
    };
  }
  if (k >= 5) {
    return {
      chance: 'possible',
      detail: `Kp ${k.toFixed(1)} — aurora possible on northern Colorado horizon (estimate).`,
    };
  }
  return {
    chance: 'unlikely',
    detail: `Kp ${k.toFixed(1)} — aurora unlikely at Colorado latitudes (estimate).`,
  };
}

/**
 * Convert GOES long-channel soft X-ray flux (W/m²) to flare class (e.g. C1.2).
 * @param {number | null | undefined} flux
 * @returns {string | null}
 */
export function xrayFluxToClass(flux) {
  if (flux == null || !Number.isFinite(Number(flux)) || Number(flux) <= 0) return null;
  const f = Number(flux);
  /** @type {[string, number][]} */
  const tiers = [
    ['X', 1e-4],
    ['M', 1e-5],
    ['C', 1e-6],
    ['B', 1e-7],
    ['A', 1e-8],
  ];
  for (const [letter, threshold] of tiers) {
    if (f >= threshold) {
      const mult = f / threshold;
      return `${letter}${mult >= 9.95 ? '9.9' : mult.toFixed(1)}`;
    }
  }
  return 'A0.0';
}
