#!/usr/bin/env bash
# After a push to gh-pages, wait for GitHub's canonical Pages deployment workflow
# and fail if it errors. The legacy /pages/builds endpoint can falsely report
# "Page build failed" even when pages-build-deployment succeeds and publishes.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"
EXPECT_SHA="${1:-}"
MAX_ATTEMPTS="${PAGES_BUILD_MAX_ATTEMPTS:-180}" # ~15 minutes at 5s
SLEEP_SECS="${PAGES_BUILD_POLL_SECS:-5}"
MAX_RERUNS="${PAGES_BUILD_MAX_RERUNS:-3}" # self-heal transient in-progress-deployment conflicts

echo "wait-for-pages-build: polling builds for ${REPO} (expect=${EXPECT_SHA:-any})"

export REPO TOKEN EXPECT_SHA MAX_ATTEMPTS SLEEP_SECS MAX_RERUNS
node --input-type=module <<'NODE'
import { waitForPagesBuild } from './scripts/ci/pages-build-status.js';

const repo = process.env.REPO;
const token = process.env.TOKEN;
const expect = process.env.EXPECT_SHA || '';
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 180);
const sleepSecs = Number(process.env.SLEEP_SECS || 5);
const maxReruns = Number(process.env.MAX_RERUNS || 3);

async function api(path, { method = 'GET' } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cowx-wait-for-pages-build',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${method} ${path}: ${body.slice(0, 200)}`);
  }
  // Re-run endpoints return 201 with an empty body.
  return res.status === 204 || res.status === 201 ? null : res.json();
}

try {
  const hit = await waitForPagesBuild({
    fetchBuilds: async () => {
      const response = await api(`/repos/${repo}/actions/runs?branch=gh-pages&per_page=20`);
      return response.workflow_runs.filter(
        (run) => run.path === 'dynamic/pages/pages-build-deployment',
      );
    },
    expect,
    maxAttempts,
    sleepSecs,
    maxReruns,
    rerunBuild: async (build) => {
      // GitHub reuses the run id and bumps run_attempt; a full re-run re-attempts
      // both build and deploy once the blocking deployment has settled.
      await api(`/repos/${repo}/actions/runs/${build.id}/rerun`, { method: 'POST' });
    },
    onRerun({ rerunsUsed, maxReruns: total, build }) {
      console.log(
        `  re-run ${rerunsUsed}/${total}: retrying transient Pages deploy failure for run=${build.id ?? '-'} commit=${String(build.head_sha).slice(0, 7)}`,
      );
    },
    onAttempt({ attempt, maxAttempts: total, status, error, build }) {
      if (!build) {
        console.log(`  attempt ${attempt}/${total}: no matching build yet`);
        return;
      }
      console.log(
        `  attempt ${attempt}/${total}: status=${status} conclusion=${build.conclusion ?? '-'} commit=${String(build.head_sha).slice(0, 7)} run=${build.id ?? '-'} error=${error}`,
      );
    },
  });
  console.log(
    `wait-for-pages-build: Pages deployment succeeded for ${String(hit.head_sha).slice(0, 7)} (run=${hit.id ?? '-'})`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  console.error(
    'wait-for-pages-build: failing so Actions does not report green while the CDN is frozen',
  );
  process.exit(1);
}
NODE
