#!/usr/bin/env bash
# Commit freshly fetched public/data and push to main.
#
# Concurrent main pushes (code merges, overlapping weather runs) used to fail
# here: commit-then-`git pull --rebase` hit mass conflicts in generated JSON.
# Instead, snapshot the fetch output and replay it onto the tip of origin/main
# each attempt — always prefer the just-fetched tree over whatever is on main.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${REPO_ROOT}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git diff --quiet public/data; then
  echo "No data changes to commit"
  exit 0
fi

STASH_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${STASH_DIR}"
}
trap cleanup EXIT

cp -a public/data "${STASH_DIR}/data"

for attempt in 1 2 3 4; do
  git fetch origin main
  git reset --hard origin/main
  rm -rf public/data
  cp -a "${STASH_DIR}/data" public/data

  if git diff --quiet public/data; then
    echo "Fetched data already matches origin/main"
    exit 0
  fi

  git add public/data
  git commit -m "chore: update weather data"

  if git push origin HEAD:main; then
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}); replaying fetch onto latest origin/main"
done

echo "::error::Failed to push weather data commit after retries"
exit 1
