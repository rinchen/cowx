/**
 * CAIC avalanche forecast offsite links (no scrape — CAIC ToS prohibit robots/data mining).
 * Mountain-region catalog points get a link to the official forecasts hub.
 */

/** Regions where avalanche terrain is relevant. */
const MOUNTAIN_REGIONS = new Set(['mountains', 'northwest', 'southwest']);

export const CAIC_FORECASTS_URL = 'https://avalanche.state.co.us/forecasts';
export const CAIC_HOME_URL = 'https://avalanche.state.co.us/';

/**
 * @param {unknown} region
 * @returns {boolean}
 */
export function isCaicRelevantRegion(region) {
  return MOUNTAIN_REGIONS.has(
    String(region ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Build links.caic entry for a catalog location (or null when not mountain-relevant).
 * @param {{ region?: string, name?: string } | null | undefined} loc
 * @returns {{ name: string, url: string, note: string } | null}
 */
export function buildCaicLink(loc) {
  if (!loc || !isCaicRelevantRegion(loc.region)) return null;
  return {
    name: 'CAIC avalanche forecasts',
    url: CAIC_FORECASTS_URL,
    note: 'Offsite — check CAIC before entering avalanche terrain. COWX does not scrape CAIC data.',
  };
}
