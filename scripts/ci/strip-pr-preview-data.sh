#!/usr/bin/env bash
# Remove duplicated weather JSON under pr-preview/*/data on gh-pages.
# Legacy GitHub Pages builds fail (duration 0) when a full public/data tree is
# preserved under pr-preview via clean-exclude — freezing the CDN on the last
# successful build while Actions still reports green.
set -euo pipefail

ROOT="${1:-.}"
PREVIEW_ROOT="${ROOT}/pr-preview"

if [[ ! -d "${PREVIEW_ROOT}" ]]; then
  echo "strip-pr-preview-data: no pr-preview/ under ${ROOT} — nothing to do"
  exit 0
fi

removed=0
while IFS= read -r -d '' dir; do
  echo "strip-pr-preview-data: removing ${dir}"
  rm -rf "${dir}"
  removed=$((removed + 1))
done < <(find "${PREVIEW_ROOT}" -type d -name data -print0 2>/dev/null || true)

echo "strip-pr-preview-data: removed ${removed} data director$([[ ${removed} -eq 1 ]] && echo y || echo ies)"
