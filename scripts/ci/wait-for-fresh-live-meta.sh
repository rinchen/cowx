#!/usr/bin/env bash
# After Check Stale Data dispatches Update Weather at the notify tier, poll live
# meta until recovery is visible (or timeout). Prevents false Discord pages when
# a fetch was already in flight or the just-dispatched run is about to land.
#
# Env:
#   LIVE_META_URL                 — production meta.json URL (required)
#   BASELINE_GENERATED_AT         — generatedAt when notify fired (optional)
#   RECOVERED_MAX_AGE_MINUTES     — recovered when age < this (default 90)
#   WAIT_TIMEOUT_MINUTES          — give up after this many minutes (default 20)
#   POLL_SECS                     — sleep between polls (default 30)
#   GITHUB_OUTPUT                 — recovered, final_generated_at, final_age_minutes
#
# Always exits 0 when configured; callers fail the job from recovered=false.
set -euo pipefail

LIVE_META_URL="${LIVE_META_URL:?LIVE_META_URL required}"
BASELINE_GENERATED_AT="${BASELINE_GENERATED_AT:-}"
RECOVERED_MAX_AGE_MINUTES="${RECOVERED_MAX_AGE_MINUTES:-90}"
WAIT_TIMEOUT_MINUTES="${WAIT_TIMEOUT_MINUTES:-20}"
POLL_SECS="${POLL_SECS:-30}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RECOVERY_JS="${ROOT}/scripts/ci/live-meta-recovery.js"

deadline_ms="$(node -e "process.stdout.write(String(Date.now() + ${WAIT_TIMEOUT_MINUTES} * 60000))")"
recovered="false"
final_generated_at=""
final_age_minutes=""

emit_outputs() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "recovered=${recovered}"
      echo "final_generated_at=${final_generated_at}"
      echo "final_age_minutes=${final_age_minutes}"
    } >>"${GITHUB_OUTPUT}"
  fi
}

read_live_meta() {
  local body="$1"
  local now_ms="$2"
  LIVE_META_BODY="${body}" BASELINE_GENERATED_AT="${BASELINE_GENERATED_AT}" \
    RECOVERED_MAX_AGE_MINUTES="${RECOVERED_MAX_AGE_MINUTES}" NOW_MS="${now_ms}" \
    RECOVERY_JS="${RECOVERY_JS}" node --input-type=module <<'NODE'
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.env.RECOVERY_JS).href);
const { ageMinutesFromIso, liveMetaRecovered, parseGeneratedAt } = mod;
const body = process.env.LIVE_META_BODY || '';
let generatedAt = '';
try {
  generatedAt = parseGeneratedAt(JSON.parse(body));
} catch {
  generatedAt = '';
}
const age = generatedAt ? ageMinutesFromIso(generatedAt, Number(process.env.NOW_MS)) : null;
const recovered = liveMetaRecovered({
  generatedAt,
  ageMinutes: age,
  baselineGeneratedAt: process.env.BASELINE_GENERATED_AT || '',
  recoveredMaxAgeMinutes: Number(process.env.RECOVERED_MAX_AGE_MINUTES || 90),
});
process.stdout.write(
  [generatedAt, age == null ? '' : String(age), recovered ? 'true' : 'false'].join('\t'),
);
NODE
}

echo "wait-for-fresh-live-meta: url=${LIVE_META_URL} baseline=${BASELINE_GENERATED_AT:--} recovered_max_age=${RECOVERED_MAX_AGE_MINUTES}m timeout=${WAIT_TIMEOUT_MINUTES}m poll=${POLL_SECS}s"

while true; do
  now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
  if [[ "${now_ms}" -ge "${deadline_ms}" ]]; then
    echo "wait-for-fresh-live-meta: timeout after ${WAIT_TIMEOUT_MINUTES}m (last generatedAt=${final_generated_at:--} age=${final_age_minutes:--}m)"
    break
  fi

  body=""
  if ! body="$(curl -fsS --max-time 30 "${LIVE_META_URL}" 2>/dev/null)"; then
    echo "wait-for-fresh-live-meta: fetch failed; retrying"
  else
    readout="$(read_live_meta "${body}" "${now_ms}")" || readout=$'\t\tfalse'
    IFS=$'\t' read -r final_generated_at final_age_minutes recovered <<<"${readout}"
    echo "wait-for-fresh-live-meta: generatedAt=${final_generated_at:--} age_minutes=${final_age_minutes:--} recovered=${recovered}"
    if [[ "${recovered}" == "true" ]]; then
      echo "wait-for-fresh-live-meta: recovery observed"
      emit_outputs
      exit 0
    fi
  fi

  sleep "${POLL_SECS}"
done

emit_outputs
exit 0
