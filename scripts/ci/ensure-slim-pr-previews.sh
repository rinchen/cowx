#!/usr/bin/env bash
# Checkout gh-pages, strip pr-preview/*/data, push if dirty.
# Runs before JamesIves production deploys so clean-exclude cannot re-poison the tip.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STRIP="${REPO_ROOT}/scripts/ci/strip-pr-preview-data.sh"
WORKTREE="$(mktemp -d)"
cleanup() {
  git worktree remove --force "${WORKTREE}" 2>/dev/null || rm -rf "${WORKTREE}"
}
trap cleanup EXIT

git fetch origin gh-pages
git worktree add --detach "${WORKTREE}" origin/gh-pages

bash "${STRIP}" "${WORKTREE}"

cd "${WORKTREE}"
if [[ -z "$(git status --porcelain)" ]]; then
  echo "ensure-slim-pr-previews: gh-pages already has no pr-preview data trees"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -m "chore: strip weather data from PR previews"
git push origin HEAD:gh-pages
echo "ensure-slim-pr-previews: pushed slim cleanup to gh-pages"
