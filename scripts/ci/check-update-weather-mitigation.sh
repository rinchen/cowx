#!/usr/bin/env bash
# Classify whether Update Weather is still the reason live meta looks stale.
# Used by check-stale-data.yml to skip a redundant dispatch and to suppress
# Discord when a fetch is queued/running or just succeeded (CDN lag).
#
# Env:
#   GH_TOKEN                      — gh auth (Actions)
#   GITHUB_REPOSITORY             — owner/name (Actions default)
#   REPO                          — override owner/name
#   RECENT_SUCCESS_GRACE_MINUTES  — treat a successful run this new as active
#                                   (default 10; use 0 before dispatch)
#   GITHUB_OUTPUT                 — inflight=true|false
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:?GITHUB_REPOSITORY or REPO required}}"
RECENT_SUCCESS_GRACE_MINUTES="${RECENT_SUCCESS_GRACE_MINUTES:-10}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RECOVERY_JS="${ROOT}/scripts/ci/live-meta-recovery.js"

run_count() {
  local status="$1"
  gh run list --repo "${REPO}" \
    --workflow update-weather.yml --status "${status}" --limit 1 --json databaseId \
    --jq 'length' || echo 0
}

in_progress="$(run_count in_progress)"
queued="$(run_count queued)"
pending="$(run_count pending)"
waiting="$(run_count waiting)"
queued_total="$(
  node -e 'process.stdout.write(String((Number(process.argv[1])||0)+(Number(process.argv[2])||0)+(Number(process.argv[3])||0)))' \
    "${queued}" "${pending}" "${waiting}"
)"

success_at="$(
  gh run list --repo "${REPO}" --workflow update-weather.yml --status completed --limit 10 \
    --json conclusion,updatedAt \
    --jq '[.[] | select(.conclusion == "success")][0].updatedAt // empty' || true
)"

inflight="$(
  LATEST_SUCCESS_COMPLETED_AT="${success_at}" \
    IN_PROGRESS_COUNT="${in_progress}" \
    QUEUED_COUNT="${queued_total}" \
    RECENT_SUCCESS_GRACE_MINUTES="${RECENT_SUCCESS_GRACE_MINUTES}" \
    RECOVERY_JS="${RECOVERY_JS}" \
    node --input-type=module <<'NODE'
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.env.RECOVERY_JS).href);
const active = mod.updateWeatherMitigationActive({
  inProgressCount: Number(process.env.IN_PROGRESS_COUNT || 0),
  queuedCount: Number(process.env.QUEUED_COUNT || 0),
  latestSuccessCompletedAt: process.env.LATEST_SUCCESS_COMPLETED_AT || '',
  recentSuccessGraceMinutes: Number(process.env.RECENT_SUCCESS_GRACE_MINUTES || 10),
});
process.stdout.write(active ? 'true' : 'false');
NODE
)"

echo "check-update-weather-mitigation: in_progress=${in_progress} queued=${queued_total} latest_success=${success_at:--} grace=${RECENT_SUCCESS_GRACE_MINUTES}m inflight=${inflight}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "inflight=${inflight}" >>"${GITHUB_OUTPUT}"
fi
