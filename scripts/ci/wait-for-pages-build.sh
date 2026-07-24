#!/usr/bin/env bash
# After a push to gh-pages, wait for the GitHub Pages build and fail if it errors.
# JamesIves / pr-preview can succeed while the legacy Pages publisher rejects the
# tip — without this check, production stays frozen on the last good CDN build.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"
EXPECT_SHA="${1:-}"
MAX_ATTEMPTS="${PAGES_BUILD_MAX_ATTEMPTS:-36}" # ~3 minutes at 5s
SLEEP_SECS="${PAGES_BUILD_POLL_SECS:-5}"

echo "wait-for-pages-build: polling builds for ${REPO} (expect=${EXPECT_SHA:-any})"

export REPO TOKEN EXPECT_SHA MAX_ATTEMPTS SLEEP_SECS
node <<'NODE'
const repo = process.env.REPO;
const token = process.env.TOKEN;
const expect = process.env.EXPECT_SHA || '';
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 36);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const prefix = expect.slice(0, 7);

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const builds = await api(`/repos/${repo}/pages/builds?per_page=5`);
  const hit = expect
    ? builds.find((b) => b.commit && (b.commit === expect || b.commit.startsWith(prefix)))
    : builds[0];
  if (!hit) {
    console.log(`  attempt ${attempt}/${maxAttempts}: no matching build yet`);
    await sleep(sleepSecs * 1000);
    continue;
  }
  const err = (hit.error && hit.error.message) || '-';
  console.log(
    `  attempt ${attempt}/${maxAttempts}: status=${hit.status} commit=${String(hit.commit).slice(0, 7)} duration=${hit.duration ?? '-'} error=${err}`,
  );
  if (hit.status === 'built') {
    console.log(`wait-for-pages-build: Pages build succeeded for ${String(hit.commit).slice(0, 7)}`);
    process.exit(0);
  }
  if (hit.status === 'errored') {
    console.error(`::error::GitHub Pages build failed for ${String(hit.commit).slice(0, 7)}: ${err}`);
    console.error(
      'wait-for-pages-build: failing so Actions does not report green while the CDN is frozen',
    );
    process.exit(1);
  }
  await sleep(sleepSecs * 1000);
}

console.error(`::error::Timed out waiting for GitHub Pages build (expect=${expect || 'any'})`);
process.exit(1);
NODE
