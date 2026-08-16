/**
 * Workspace header notice when Open-Meteo (or related) fetch left this location delayed/stale.
 */

import { escapeHtml } from './dom.js';

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function providerDelayBannerHtml(data) {
  const providerDelay = data.providerDelay === true || data.forecastStale === true;
  if (!providerDelay) return '';
  const delayAt = data.providerDelayAt ?? data.updatedAt ?? data.updated_at ?? null;
  let delayStamp = '';
  if (delayAt) {
    try {
      delayStamp = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(String(delayAt)));
    } catch {
      delayStamp = String(delayAt);
    }
  }
  return `<p class="stale-banner stale-banner--header" role="status">Data provider delays: this info may be slightly outdated.${delayStamp ? ` · Snapshot ${escapeHtml(delayStamp)} MT` : ''}</p>`;
}
