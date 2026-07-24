#!/usr/bin/env bash
# Check production meta.json age. Exit 0 if fresh, 1 if stale or unreachable.
#
# Env:
#   LIVE_META_URL   — production meta.json URL (required)
#   STALE_MINUTES   — stale threshold (default 120)
#   GITHUB_OUTPUT   — when set, write generated_at= and age_minutes=
set -euo pipefail

LIVE_META_URL="${LIVE_META_URL:?LIVE_META_URL required}"
STALE_MINUTES="${STALE_MINUTES:-120}"

echo "check-stale-live-meta: fetching ${LIVE_META_URL}"
body="$(curl -fsS --max-time 30 "${LIVE_META_URL}")" || {
  echo "::error::Could not fetch live meta.json from ${LIVE_META_URL}"
  exit 1
}

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
')" || {
  echo "::error::Live meta.json missing generatedAt"
  exit 1
}

age_minutes="$(node -e '
  const iso = process.argv[1];
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) process.exit(2);
  process.stdout.write(String(Math.floor((Date.now() - t) / 60000)));
' "${generated_at}")" || {
  echo "::error::Could not parse generatedAt=${generated_at}"
  exit 1
}

echo "check-stale-live-meta: generatedAt=${generated_at} age_minutes=${age_minutes} stale_minutes=${STALE_MINUTES}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "generated_at=${generated_at}"
    echo "age_minutes=${age_minutes}"
  } >>"${GITHUB_OUTPUT}"
fi

if [[ "${age_minutes}" -ge "${STALE_MINUTES}" ]]; then
  echo "::error::Production weather data is stale (${age_minutes}m >= ${STALE_MINUTES}m)"
  exit 1
fi

echo "check-stale-live-meta: OK (fresh)"
exit 0
