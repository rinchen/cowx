#!/usr/bin/env bash
# After a push to gh-pages, wait for the GitHub Pages build and fail if it errors.
# JamesIves / pr-preview can succeed while the legacy Pages publisher rejects the
# tip — without this check, production stays frozen on the last good CDN build.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"
EXPECT_SHA="${1:-}"
MAX_ATTEMPTS="${PAGES_BUILD_MAX_ATTEMPTS:-180}" # ~15 minutes at 5s
SLEEP_SECS="${PAGES_BUILD_POLL_SECS:-5}"

echo "wait-for-pages-build: polling builds for ${REPO} (expect=${EXPECT_SHA:-any})"

export REPO TOKEN EXPECT_SHA MAX_ATTEMPTS SLEEP_SECS
node --input-type=module <<'NODE'
import { waitForPagesBuild } from './scripts/ci/pages-build-status.js';

const repo = process.env.REPO;
const token = process.env.TOKEN;
const expect = process.env.EXPECT_SHA || '';
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 180);
const sleepSecs = Number(process.env.SLEEP_SECS || 5);

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cowx-wait-for-pages-build',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

try {
  const hit = await waitForPagesBuild({
    fetchBuilds: () => api(`/repos/${repo}/pages/builds?per_page=5`),
    expect,
    maxAttempts,
    sleepSecs,
    onAttempt({ attempt, maxAttempts: total, status, error, build }) {
      if (!build) {
        console.log(`  attempt ${attempt}/${total}: no matching build yet`);
        return;
      }
      console.log(
        `  attempt ${attempt}/${total}: status=${status} commit=${String(build.commit).slice(0, 7)} duration=${build.duration ?? '-'} error=${error}`,
      );
    },
  });
  console.log(`wait-for-pages-build: Pages build succeeded for ${String(hit.commit).slice(0, 7)}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  console.error(
    'wait-for-pages-build: failing so Actions does not report green while the CDN is frozen',
  );
  process.exit(1);
}
NODE
