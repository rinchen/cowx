#!/usr/bin/env bash
# After a push to gh-pages, wait for GitHub's canonical Pages deployment workflow
# and fail if it errors. The legacy /pages/builds endpoint can falsely report
# "Page build failed" even when pages-build-deployment succeeds and publishes.
#
# Transient "due to in progress deployment" conflicts are self-healed: clear the
# blocking deployment lock, wait, then re-run the failed Pages workflow.
# Cancelled tip builds / "Deployment cancelled." / deploy-pages timeouts are
# re-run without cancelling the tip SHA (tip cancel races the next deploy).
# Prior tips that stay deployment_in_progress after a timeout are cleared on
# preflight and before each re-run so the tip is not blocked for another ~10m.
#
# A tip with no pages-build-deployment at all (rapid gh-pages pushes during an
# in-flight build) is self-healed via POST /pages/builds after a short grace.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"
EXPECT_SHA="${1:-}"
# ~30 minutes at 5s — covers long Actions queues plus ~10m weather-tree deploys.
MAX_ATTEMPTS="${PAGES_BUILD_MAX_ATTEMPTS:-360}"
SLEEP_SECS="${PAGES_BUILD_POLL_SECS:-5}"
MAX_RERUNS="${PAGES_BUILD_MAX_RERUNS:-5}"
RERUN_DELAY_SECS="${PAGES_BUILD_RERUN_DELAY_SECS:-60}"
MAX_MISSING_BUILD_REQUESTS="${PAGES_BUILD_MAX_MISSING_REQUESTS:-2}"
MISSING_BUILD_AFTER_ATTEMPTS="${PAGES_BUILD_MISSING_AFTER_ATTEMPTS:-12}" # ~60s

echo "wait-for-pages-build: polling builds for ${REPO} (expect=${EXPECT_SHA:-any})"

export REPO TOKEN EXPECT_SHA MAX_ATTEMPTS SLEEP_SECS MAX_RERUNS RERUN_DELAY_SECS
export MAX_MISSING_BUILD_REQUESTS MISSING_BUILD_AFTER_ATTEMPTS
node --input-type=module <<'NODE'
import {
  diagnosePagesFailureText,
  findWedgedNonTipShas,
  sameCommitSha,
  waitForPagesBuild,
} from './scripts/ci/pages-build-status.js';

const repo = process.env.REPO;
const token = process.env.TOKEN;
const expect = process.env.EXPECT_SHA || '';
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 360);
const sleepSecs = Number(process.env.SLEEP_SECS || 5);
const maxReruns = Number(process.env.MAX_RERUNS || 5);
const rerunDelaySecs = Number(process.env.RERUN_DELAY_SECS || 60);
const maxMissingBuildRequests = Number(process.env.MAX_MISSING_BUILD_REQUESTS || 2);
const missingBuildRequestAfterAttempts = Number(
  process.env.MISSING_BUILD_AFTER_ATTEMPTS || 12,
);

async function api(path, { method = 'GET', body, okStatuses = null } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cowx-wait-for-pages-build',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (okStatuses && okStatuses.includes(res.status)) {
    return res.status === 204 || res.status === 201 ? null : res.json().catch(() => null);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${method} ${path}: ${text.slice(0, 200)}`);
  }
  // Re-run / cancel endpoints often return 201/204 with an empty body.
  return res.status === 204 || res.status === 201 ? null : res.json();
}

/**
 * Pull deploy-pages failure text from check-run annotations (preferred) or
 * truncated job logs so we can detect the transient lock conflict.
 * @param {Record<string, unknown>} build
 */
async function failureTextForBuild(build) {
  const runId = build.id;
  const attempt = build.run_attempt ?? 1;
  const jobsPath =
    attempt && Number(attempt) > 1
      ? `/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`
      : `/repos/${repo}/actions/runs/${runId}/jobs`;
  const jobsPayload = await api(jobsPath);
  const jobs = jobsPayload?.jobs ?? [];
  const failed =
    jobs.find((j) => j.name === 'deploy' && j.conclusion === 'failure') ??
    jobs.find((j) => j.conclusion === 'failure');
  if (!failed) return '';

  if (failed.check_run_url) {
    try {
      const checkPath = new URL(failed.check_run_url).pathname.replace(/^\/api\/v3/, '');
      const annotations = await api(`${checkPath}/annotations`);
      const joined = (annotations ?? [])
        .map((a) => `${a.message ?? ''}\n${a.title ?? ''}`)
        .join('\n');
      if (joined.trim()) return joined;
    } catch {
      // Fall through to job logs.
    }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${failed.id}/logs`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cowx-wait-for-pages-build',
      },
      redirect: 'follow',
    });
    if (res.ok) {
      const text = await res.text();
      // Keep the tail — the deploy-pages error is near the end.
      return text.slice(-8000);
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Clear a wedged/prior Pages deployment lock so the tip can publish.
 * @param {string} blockingSha
 */
async function clearBlockingDeployment(blockingSha) {
  console.log(`  clearing Pages lock for blocker ${blockingSha.slice(0, 7)}…`);
  // Official Pages cancel (no-op when already finished).
  try {
    await api(`/repos/${repo}/pages/deployments/${blockingSha}/cancel`, {
      method: 'POST',
      okStatuses: [204, 400],
    });
  } catch (err) {
    console.log(`  pages cancel skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const deployments = await api(
    `/repos/${repo}/deployments?sha=${blockingSha}&environment=github-pages&per_page=20`,
  );
  for (const dep of deployments ?? []) {
    try {
      await api(`/repos/${repo}/deployments/${dep.id}/statuses`, {
        method: 'POST',
        body: { state: 'inactive', description: 'Clear stuck Pages deploy lock' },
        okStatuses: [201, 422],
      });
    } catch (err) {
      console.log(
        `  inactive ${dep.id} skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await api(`/repos/${repo}/deployments/${dep.id}`, {
        method: 'DELETE',
        okStatuses: [204, 422],
      });
      console.log(`  deleted deployment ${dep.id} (${blockingSha.slice(0, 7)})`);
    } catch (err) {
      console.log(
        `  delete ${dep.id} skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Discover prior (non-tip) SHAs whose Pages deployment is still in progress.
 * @param {string} tipSha
 * @returns {Promise<string[]>}
 */
async function findWedgedNonTipDeployments(tipSha) {
  /** @type {Set<string>} */
  const candidates = new Set();

  try {
    const deployments = await api(
      `/repos/${repo}/deployments?environment=github-pages&per_page=30`,
    );
    for (const dep of deployments ?? []) {
      if (typeof dep?.sha === 'string' && dep.sha) candidates.add(dep.sha);
    }
  } catch (err) {
    console.log(
      `  wedge scan deployments skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const response = await api(`/repos/${repo}/actions/runs?branch=gh-pages&per_page=20`);
    for (const run of response?.workflow_runs ?? []) {
      if (
        run?.path === 'dynamic/pages/pages-build-deployment' &&
        typeof run.head_sha === 'string' &&
        run.head_sha
      ) {
        candidates.add(run.head_sha);
      }
    }
  } catch (err) {
    console.log(
      `  wedge scan workflow runs skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  /** @type {{ sha: string, status: unknown }[]} */
  const entries = [];
  for (const sha of candidates) {
    if (sameCommitSha(sha, tipSha)) continue;
    try {
      const info = await api(`/repos/${repo}/pages/deployments/${sha}`, {
        okStatuses: [200, 404],
      });
      if (!info) continue;
      entries.push({ sha, status: info.status });
    } catch (err) {
      console.log(
        `  wedge status ${sha.slice(0, 7)} skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return findWedgedNonTipShas(tipSha, entries);
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
    rerunDelaySecs,
    maxMissingBuildRequests,
    missingBuildRequestAfterAttempts,
    diagnoseFailure: async (build) => {
      const text = await failureTextForBuild(build);
      return diagnosePagesFailureText(text);
    },
    clearBlockingDeployment,
    findWedgedNonTipDeployments,
    rerunBuild: async (build) => {
      // GitHub reuses the run id and bumps run_attempt; a full re-run re-attempts
      // both build and deploy once the blocking deployment has settled.
      await api(`/repos/${repo}/actions/runs/${build.id}/rerun`, { method: 'POST' });
    },
    requestMissingBuild: async () => {
      // Rebuilds the current gh-pages tip when GitHub never enqueued a workflow.
      await api(`/repos/${repo}/pages/builds`, { method: 'POST', okStatuses: [201, 409] });
    },
    onClearWedges({ shas, reason }) {
      const list = shas.map((s) => s.slice(0, 7)).join(', ');
      console.log(`  cleared non-tip Pages wedge(s) (${reason}): ${list}`);
    },
    onRerun({ rerunsUsed, maxReruns: total, build, blockingSha, detail }) {
      console.log(
        `  re-run ${rerunsUsed}/${total}: run=${build.id ?? '-'} commit=${String(build.head_sha).slice(0, 7)} blocker=${blockingSha ? blockingSha.slice(0, 7) : '-'} delay=${rerunDelaySecs}s${detail ? ` (${detail})` : ''}`,
      );
    },
    onMissingBuildRequest({ requestsUsed, maxRequests, expectSha }) {
      console.log(
        `  requesting Pages build ${requestsUsed}/${maxRequests} for tip ${String(expectSha).slice(0, 7)} (no workflow yet)`,
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
