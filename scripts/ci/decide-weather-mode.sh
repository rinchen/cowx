#!/usr/bin/env bash
# Decide update-weather mode from live CDN meta vs main's public/data/meta.json.
# Prints: mode=skip|deploy_only|fetch  (and age diagnostics on stderr / GITHUB_OUTPUT).
#
# Env:
#   LIVE_META_URL   — production meta.json URL (required)
#   MAIN_META_PATH  — path to checked-out meta.json (default public/data/meta.json)
#   FRESH_MINUTES   — treat younger than this as fresh (default 40)
#   GITHUB_OUTPUT   — when set (Actions), also write mode=... for job outputs
set -euo pipefail

LIVE_META_URL="${LIVE_META_URL:?LIVE_META_URL required}"
MAIN_META_PATH="${MAIN_META_PATH:-public/data/meta.json}"
FRESH_MINUTES="${FRESH_MINUTES:-40}"

now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"

age_minutes_from_iso() {
  local iso="$1"
  node -e '
    const iso = process.argv[1];
    const now = Number(process.argv[2]);
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) process.exit(2);
    const mins = Math.floor((now - t) / 60000);
    process.stdout.write(String(mins));
  ' "${iso}" "${now_ms}"
}

live_iso=""
live_age=""
live_ok=0
if live_body="$(curl -fsS --max-time 30 "${LIVE_META_URL}" 2>/dev/null)"; then
  live_iso="$(printf '%s' "${live_body}" | node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      try {
        const m = JSON.parse(s);
        const v = m.generatedAt ?? m.updated_at ?? "";
        process.stdout.write(String(v));
      } catch {
        process.exit(2);
      }
    });
  ')" || live_iso=""
  if [[ -n "${live_iso}" ]]; then
    if live_age="$(age_minutes_from_iso "${live_iso}")"; then
      live_ok=1
    else
      live_iso=""
      live_age=""
    fi
  fi
fi

main_iso=""
main_age=""
main_ok=0
if [[ -f "${MAIN_META_PATH}" ]]; then
  main_iso="$(node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(m.generatedAt ?? m.updated_at ?? ""));
  ' "${MAIN_META_PATH}")" || main_iso=""
  if [[ -n "${main_iso}" ]]; then
    if main_age="$(age_minutes_from_iso "${main_iso}")"; then
      main_ok=1
    else
      main_iso=""
      main_age=""
    fi
  fi
fi

mode="fetch"
if [[ "${live_ok}" -eq 1 ]] && [[ "${live_age}" -lt "${FRESH_MINUTES}" ]]; then
  mode="skip"
elif [[ "${live_ok}" -eq 1 ]] && [[ "${live_age}" -ge "${FRESH_MINUTES}" ]] &&
  [[ "${main_ok}" -eq 1 ]] && [[ "${main_age}" -lt "${FRESH_MINUTES}" ]]; then
  mode="deploy_only"
else
  mode="fetch"
fi

{
  echo "decide-weather-mode: live_ok=${live_ok} live_iso=${live_iso:--} live_age_min=${live_age:--}"
  echo "decide-weather-mode: main_ok=${main_ok} main_iso=${main_iso:--} main_age_min=${main_age:--}"
  echo "decide-weather-mode: fresh_minutes=${FRESH_MINUTES} mode=${mode}"
} >&2

echo "mode=${mode}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "mode=${mode}"
    echo "live_iso=${live_iso}"
    echo "live_age_min=${live_age}"
    echo "main_iso=${main_iso}"
    echo "main_age_min=${main_age}"
  } >>"${GITHUB_OUTPUT}"
fi
