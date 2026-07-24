/**
 * Shared road / pass alert text matchers for CDOT ArcGIS and COtrip feeds.
 */

/** Pass names and mountain corridors commonly called out in Colorado road alerts. */
export const PASS_HINT_RE =
  /\b(i-?70|us-?550|us-?40|us-?285|us-?160|us-?50|loveland|vail|eisenhower|monarch|wolf creek|red mountain|independence|cottonwood|hoosier|berthoud|rabbit ears|cameron|trail ridge|molas|coal bank)\b/i;

export const CHAIN_RE = /\bchain\b/i;

/** Closure phrasing from CDOT ArcGIS and COtrip incident/condition text. */
export const CLOSURE_RE = /\b(closure|closed|roadway.?closure|lane is closed|lanes? closed)\b/i;
