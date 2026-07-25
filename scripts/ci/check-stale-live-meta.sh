#!/usr/bin/env bash
# Classify production meta.json age into two tiers so recovery stays quiet and
# only a failed recovery pages a human.
#
#   fresh                        -> stale=false notify=false
#   STALE_MINUTES  .. NOTIFY-1   -> stale=true  notify=false  (self-heal only)
#   >= NOTIFY_MINUTES            -> stale=true  notify=true   (mitigations failed)
#
# Unreachable / unparseable meta cannot be aged, so it is treated as notify —
# a missing data file on the CDN is worse than a stale one.
#
# Env:
#   LIVE_META_URL   — production meta.json URL (required)
#   STALE_MINUTES   — self-heal threshold in minutes (default 90)
#   NOTIFY_MINUTES  — Discord / page-a-human threshold in minutes (default 120)
#   GITHUB_OUTPUT   — when set, write generated_at, age_minutes, reachable, stale, notify
#
# Exits 0 whenever the age could be evaluated; callers decide run status from
# the outputs. Exits non-zero only on missing configuration.
set -euo pipefail

LIVE_META_URL="${LIVE_META_URL:?LIVE_META_URL required}"
STALE_MINUTES="${STALE_MINUTES:-90}"
NOTIFY_MINUTES="${NOTIFY_MINUTES:-120}"

generated_at=""
age_minutes=""
reachable="true"
stale="false"
notify="false"

emit_outputs() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "generated_at=${generated_at}"
      echo "age_minutes=${age_minutes}"
      echo "reachable=${reachable}"
      echo "stale=${stale}"
      echo "notify=${notify}"
    } >>"${GITHUB_OUTPUT}"
  fi
}

unreachable() {
  echo "::error::$1"
  reachable="false"
  stale="true"
  notify="true"
  emit_outputs
  exit 0
}

echo "check-stale-live-meta: fetching ${LIVE_META_URL}"
# Retry so a transient CDN blip does not masquerade as a broken site.
body="$(curl -fsS --max-time 30 --retry 3 --retry-delay 5 --retry-all-errors "${LIVE_META_URL}")" ||
  unreachable "Could not fetch live meta.json from ${LIVE_META_URL}"

generated_at="$(printf '%s' "${body}" | node -e '
  let s = "";
  process.stdin.on("data", (c) => { s += c; });
  process.stdin.on("end", () => {
    try {
      const m = JSON.parse(s);
      const v = m.generatedAt ?? m.updated_at ?? "";
      if (!v) process.exit(2);
      process.stdout.write(String(v));
    } catch {
      process.exit(2);
    }
  });
')" || unreachable "Live meta.json missing generatedAt"

age_minutes="$(node -e '
  const iso = process.argv[1];
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) process.exit(2);
  process.stdout.write(String(Math.floor((Date.now() - t) / 60000)));
' "${generated_at}")" || unreachable "Could not parse generatedAt=${generated_at}"

echo "check-stale-live-meta: generatedAt=${generated_at} age_minutes=${age_minutes} stale_minutes=${STALE_MINUTES} notify_minutes=${NOTIFY_MINUTES}"

if [[ "${age_minutes}" -ge "${NOTIFY_MINUTES}" ]]; then
  stale="true"
  notify="true"
  echo "::error::Production weather data is ${age_minutes}m old (>= ${NOTIFY_MINUTES}m) — self-heal did not recover"
elif [[ "${age_minutes}" -ge "${STALE_MINUTES}" ]]; then
  stale="true"
  echo "::warning::Production weather data is ${age_minutes}m old (>= ${STALE_MINUTES}m) — dispatching Update Weather, no alert yet"
else
  echo "check-stale-live-meta: OK (fresh)"
fi

emit_outputs
exit 0
