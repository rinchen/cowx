/**
 * Testable GitHub Pages deployment-workflow polling state machine.
 *
 * GitHub's legacy /pages/builds endpoint can report "Page build failed" while
 * the canonical dynamic/pages/pages-build-deployment workflow succeeds and
 * publishes the CDN. Use the workflow run as the source of truth.
 *
 * A common transient failure: deploy-pages rejects with
 * "due to in progress deployment. Please cancel <sha> first" when a prior
 * gh-pages commit's Pages deployment is still settling (or wedged). Re-running
 * alone is not enough — clear the blocker, wait, then re-run.
 *
 * Timeout / "Deployment cancelled." / Pages API 5xx retries must not cancel
 * the *tip* SHA (tip cancel races the next deploy). Prior tips can remain
 * deployment_in_progress after a ~10m timeout and block the tip — those
 * non-tip wedges are cleared on preflight and before each re-run.
 */

export class PagesBuildWaitError extends Error {
  /**
   * @param {'build_error'|'timeout'} code
   * @param {string} message
   * @param {Record<string, unknown> | null} [build]
   */
  constructor(code, message, build = null) {
    super(message);
    this.name = 'PagesBuildWaitError';
    this.code = code;
    this.build = build;
  }
}

/**
 * Extract the blocking commit SHA from a deploy-pages "in progress deployment"
 * error. Returns null when the failure is not that transient conflict.
 * @param {string} text
 * @returns {string | null}
 */
export function parseInProgressDeploymentBlocker(text) {
  if (!text) return null;
  const match = String(text).match(
    /due to in progress deployment\.\s*Please cancel ([a-f0-9]{40}) first/i,
  );
  return match?.[1] ?? null;
}

/**
 * Decide whether a pages-build-deployment failure is worth clearing/re-running.
 * Covers the deploy-pages lock conflict, the ~10m native deploy timeout
 * (large gh-pages trees with weather data often land near that limit),
 * "Deployment cancelled." (tip-SHA cancel/clear race — Update Weather run
 * 31105796205 / pages-build-deployment 31105859939), and Pages API 5xx /
 * outage errors that ask to re-run later (run 31710989999).
 * @param {string} text
 * @returns {{ retryable: boolean, blockingSha: string | null, detail: string }}
 */
export function diagnosePagesFailureText(text) {
  const raw = String(text ?? '');
  const blockingSha = parseInProgressDeploymentBlocker(raw);
  if (blockingSha) {
    return {
      retryable: true,
      blockingSha,
      detail: `in-progress deployment conflict; blocker=${blockingSha.slice(0, 7)}`,
    };
  }
  if (/Timeout reached,\s*aborting/i.test(raw)) {
    return {
      retryable: true,
      blockingSha: null,
      detail: 'deploy-pages timeout',
    };
  }
  // deploy-pages reports conclusion=failure with this annotation when GitHub
  // cancels the deployment (supersession, lock race after tip cancel, etc.).
  // Distinct from workflow conclusion === 'cancelled'.
  if (/Deployment cancelled\.?/i.test(raw)) {
    return {
      retryable: true,
      blockingSha: null,
      detail: 'deployment cancelled',
    };
  }
  // GitHub Pages Deployment API 5xx / 429 / outage — deploy-pages asks to
  // re-run later. Do not match 4xx lock conflicts here (handled above).
  if (
    /Failed to create deployment \(status: (?:5\d\d|429)\)/i.test(raw) ||
    /githubstatus\.com reporting a Pages outage/i.test(raw) ||
    /Please re-run the deployment at a later time/i.test(raw)
  ) {
    return {
      retryable: true,
      blockingSha: null,
      detail: 'pages deploy API 5xx',
    };
  }
  const compact = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
  return {
    retryable: false,
    blockingSha: null,
    detail: compact || 'non-retryable Pages failure',
  };
}

/**
 * Whether two commit SHAs refer to the same commit (full match or unique prefix).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameCommitSha(a, b) {
  const left = String(a ?? '')
    .trim()
    .toLowerCase();
  const right = String(b ?? '')
    .trim()
    .toLowerCase();
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * True when a Pages deployment status can block a newer tip from publishing.
 * @param {unknown} status
 * @returns {boolean}
 */
export function isWedgedPagesDeploymentStatus(status) {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return (
    s === 'deployment_in_progress' ||
    s === 'queued' ||
    s === 'pending' ||
    // Some API shapes return the bare workflow-style status.
    s === 'in_progress'
  );
}

/**
 * Filter deployment status entries down to unique non-tip wedged SHAs.
 * Never returns the tip (even if it is marked in_progress).
 * @param {string} tipSha
 * @param {{ sha?: string, status?: unknown }[]} entries
 * @returns {string[]}
 */
export function findWedgedNonTipShas(tipSha, entries) {
  const tip = String(tipSha ?? '').trim();
  /** @type {string[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const entry of entries ?? []) {
    const sha = typeof entry?.sha === 'string' ? entry.sha.trim() : '';
    if (!sha || sameCommitSha(sha, tip)) continue;
    if (!isWedgedPagesDeploymentStatus(entry?.status)) continue;
    const key = sha.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sha);
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} builds
 * @param {string} expect
 * @returns {Record<string, unknown> | null}
 */
export function findExpectedBuild(builds, expect) {
  if (!expect) return builds[0] ?? null;
  return (
    builds.find((build) => {
      const commit = typeof build.head_sha === 'string' ? build.head_sha : '';
      return sameCommitSha(commit, expect);
    }) ?? null
  );
}

/**
 * @param {Record<string, unknown>[]} builds
 * @param {string} expect
 * @returns {{
 *   state: 'pending'|'success'|'error',
 *   status: string,
 *   error: string,
 *   build: Record<string, unknown> | null,
 *   retryable?: boolean,
 *   detail?: string,
 * }}
 */
export function classifyPagesBuild(builds, expect) {
  const build = findExpectedBuild(builds, expect);
  if (!build) {
    return { state: 'pending', status: 'not_found', error: '-', build: null };
  }

  const status = typeof build.status === 'string' ? build.status : 'unknown';
  const conclusion =
    typeof build.conclusion === 'string' && build.conclusion ? build.conclusion : null;

  if (status !== 'completed') return { state: 'pending', status, error: '-', build };
  if (conclusion === 'success') return { state: 'success', status, error: '-', build };
  // Cancelled runs are often superseded mid-deploy by a newer gh-pages tip or a
  // GitHub Actions queue hiccup — treat them as retryable (not hard failures).
  if (conclusion === 'cancelled') {
    return {
      state: 'error',
      status,
      error: 'pages-build-deployment concluded cancelled',
      build,
      retryable: true,
      detail: 'cancelled (superseded or interrupted)',
    };
  }
  return {
    state: 'error',
    status,
    error: `pages-build-deployment concluded ${conclusion ?? 'without a conclusion'}`,
    build,
  };
}

/**
 * Stable identity for a specific run attempt so we only trigger one re-run per
 * failed attempt (GitHub reuses the run id and bumps run_attempt on re-run).
 * @param {Record<string, unknown> | null} build
 * @returns {string}
 */
function buildAttemptKey(build) {
  if (!build) return '';
  const id = build.id ?? '';
  const runAttempt = build.run_attempt ?? '';
  return `${id}:${runAttempt}`;
}

/**
 * @typedef {{
 *   retryable: boolean,
 *   blockingSha?: string | null,
 *   detail?: string,
 * }} PagesFailureDiagnosis
 */

/**
 * @param {{
 *   fetchBuilds: () => Promise<Record<string, unknown>[]>,
 *   expect?: string,
 *   maxAttempts?: number,
 *   sleepSecs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   diagnoseFailure?: (build: Record<string, unknown>) => Promise<PagesFailureDiagnosis>,
 *   clearBlockingDeployment?: (blockingSha: string) => Promise<void>,
 *   findWedgedNonTipDeployments?: (tipSha: string) => Promise<string[]>,
 *   rerunBuild?: (build: Record<string, unknown>) => Promise<void>,
 *   maxReruns?: number,
 *   rerunDelaySecs?: number,
 *   requestMissingBuild?: (expectSha: string) => Promise<void>,
 *   maxMissingBuildRequests?: number,
 *   missingBuildRequestAfterAttempts?: number,
 *   onAttempt?: (details: {
 *     attempt: number,
 *     maxAttempts: number,
 *     status: string,
 *     error: string,
 *     build: Record<string, unknown> | null,
 *   }) => void,
 *   onRerun?: (details: {
 *     rerunsUsed: number,
 *     maxReruns: number,
 *     build: Record<string, unknown>,
 *     blockingSha?: string | null,
 *     detail?: string,
 *   }) => void,
 *   onClearWedges?: (details: {
 *     shas: string[],
 *     reason: 'preflight' | 'rerun',
 *   }) => void,
 *   onMissingBuildRequest?: (details: {
 *     requestsUsed: number,
 *     maxRequests: number,
 *     expectSha: string,
 *   }) => void,
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function waitForPagesBuild(options) {
  const expect = options.expect ?? '';
  // Large weather trees often need ~10m once deploy starts; GitHub can also
  // leave pages-build-deployment queued for 10m+ before jobs start. 15m was
  // too tight when both pile up (see Update Weather run 31101070188).
  const maxAttempts = options.maxAttempts ?? 360;
  const sleepSecs = options.sleepSecs ?? 5;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const onAttempt = options.onAttempt ?? (() => {});
  const onRerun = options.onRerun ?? (() => {});
  const onClearWedges = options.onClearWedges ?? (() => {});
  const onMissingBuildRequest = options.onMissingBuildRequest ?? (() => {});
  const diagnoseFailure = options.diagnoseFailure ?? null;
  const clearBlockingDeployment = options.clearBlockingDeployment ?? null;
  const findWedgedNonTipDeployments = options.findWedgedNonTipDeployments ?? null;
  const rerunBuild = options.rerunBuild ?? null;
  const requestMissingBuild = options.requestMissingBuild ?? null;
  const maxReruns = options.maxReruns ?? 0;
  const rerunDelaySecs = options.rerunDelaySecs ?? 60;
  // Rapid gh-pages pushes during an in-flight pages-build-deployment can leave
  // the tip with no workflow run at all. After a short grace, request one.
  const maxMissingBuildRequests = options.maxMissingBuildRequests ?? 2;
  const missingBuildRequestAfterAttempts = options.missingBuildRequestAfterAttempts ?? 12;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(sleepSecs) || sleepSecs < 0) {
    throw new TypeError('sleepSecs must be a non-negative number');
  }
  if (!Number.isInteger(maxReruns) || maxReruns < 0) {
    throw new TypeError('maxReruns must be a non-negative integer');
  }
  if (!Number.isFinite(rerunDelaySecs) || rerunDelaySecs < 0) {
    throw new TypeError('rerunDelaySecs must be a non-negative number');
  }
  if (!Number.isInteger(maxMissingBuildRequests) || maxMissingBuildRequests < 0) {
    throw new TypeError('maxMissingBuildRequests must be a non-negative integer');
  }
  if (!Number.isInteger(missingBuildRequestAfterAttempts) || missingBuildRequestAfterAttempts < 1) {
    throw new TypeError('missingBuildRequestAfterAttempts must be a positive integer');
  }

  /**
   * Clear prior-tip Pages locks. Never cancels `expect` even if a finder
   * misreports it as wedged.
   * @param {'preflight' | 'rerun'} reason
   * @returns {Promise<string[]>}
   */
  async function clearNonTipWedges(reason) {
    if (!expect || !findWedgedNonTipDeployments || !clearBlockingDeployment) return [];
    const discovered = await findWedgedNonTipDeployments(expect);
    const shas = findWedgedNonTipShas(
      expect,
      (discovered ?? []).map((sha) => ({ sha, status: 'deployment_in_progress' })),
    );
    for (const sha of shas) {
      await clearBlockingDeployment(sha);
    }
    if (shas.length > 0) onClearWedges({ shas, reason });
    return shas;
  }

  // Preflight: drop wedged prior tips before burning a ~10m deploy-pages poll.
  await clearNonTipWedges('preflight');

  let lastStatus = 'not_found';
  let lastBuild = null;
  let rerunsUsed = 0;
  let missingBuildRequestsUsed = 0;
  let consecutiveNotFound = 0;
  /** @type {Set<string>} */
  const rerunTriggered = new Set();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const builds = await options.fetchBuilds();
    const result = classifyPagesBuild(builds, expect);
    lastStatus = result.status;
    lastBuild = result.build;
    onAttempt({ attempt, maxAttempts, ...result });

    if (result.state === 'success') return /** @type {Record<string, unknown>} */ (result.build);
    if (result.state === 'error') {
      consecutiveNotFound = 0;
      const build = /** @type {Record<string, unknown>} */ (result.build);
      const key = buildAttemptKey(build);
      // A re-run was already triggered for this attempt; wait for GitHub to
      // restart it (a new run_attempt) rather than failing on the stale result.
      if (rerunTriggered.has(key) && attempt < maxAttempts) {
        await sleep(sleepSecs * 1000);
        continue;
      }

      /** @type {PagesFailureDiagnosis} */
      let diagnosis = {
        retryable: Boolean(result.retryable) || Boolean(rerunBuild && maxReruns > 0),
        detail: result.detail,
      };
      if (diagnoseFailure && !result.retryable) {
        diagnosis = await diagnoseFailure(build);
      } else if (result.retryable) {
        // Keep classify-driven retryable (e.g. cancelled) even when a diagnose
        // hook is wired — cancelled jobs rarely have useful failure text.
        // Do not clear the tip SHA: cancelling the tip after timeout/cancel
        // races the next deploy into "Deployment cancelled." (run 31105859939).
        diagnosis = {
          retryable: true,
          detail: result.detail,
          blockingSha: null,
        };
      }

      if (diagnosis.retryable && rerunBuild && rerunsUsed < maxReruns && !rerunTriggered.has(key)) {
        rerunTriggered.add(key);
        rerunsUsed += 1;
        // Explicit lock-conflict blocker from error text (never the tip).
        const namedBlocker =
          typeof diagnosis.blockingSha === 'string' && diagnosis.blockingSha
            ? diagnosis.blockingSha
            : null;
        if (namedBlocker && !sameCommitSha(namedBlocker, expect) && clearBlockingDeployment) {
          await clearBlockingDeployment(namedBlocker);
        }
        // Timeout / cancelled: also clear any other non-tip wedges still holding
        // deployment_in_progress (today's failure mode for prior tips).
        await clearNonTipWedges('rerun');
        onRerun({
          rerunsUsed,
          maxReruns,
          build,
          blockingSha: namedBlocker,
          detail: diagnosis.detail,
        });
        // Prior weather deploys can take ~10 minutes; a short poll interval is
        // not enough for the Pages lock to release. Wait before re-running.
        if (rerunDelaySecs > 0) await sleep(rerunDelaySecs * 1000);
        await rerunBuild(build);
        if (attempt < maxAttempts) await sleep(sleepSecs * 1000);
        continue;
      }

      const commit = String(build?.head_sha ?? '').slice(0, 7) || 'unknown';
      const detail = diagnosis.detail ? ` (${diagnosis.detail})` : '';
      throw new PagesBuildWaitError(
        'build_error',
        `GitHub Pages deployment failed for ${commit}: ${result.error}${detail}`,
        build,
      );
    }

    if (result.status === 'not_found') {
      consecutiveNotFound += 1;
      const shouldRequest =
        Boolean(expect) &&
        Boolean(requestMissingBuild) &&
        missingBuildRequestsUsed < maxMissingBuildRequests &&
        consecutiveNotFound >= missingBuildRequestAfterAttempts;
      if (shouldRequest) {
        missingBuildRequestsUsed += 1;
        onMissingBuildRequest({
          requestsUsed: missingBuildRequestsUsed,
          maxRequests: maxMissingBuildRequests,
          expectSha: expect,
        });
        await requestMissingBuild(expect);
        consecutiveNotFound = 0;
      }
    } else {
      consecutiveNotFound = 0;
    }

    if (attempt < maxAttempts) await sleep(sleepSecs * 1000);
  }

  const budgetSecs = maxAttempts * sleepSecs;
  throw new PagesBuildWaitError(
    'timeout',
    `Timed out after ~${budgetSecs}s waiting for GitHub Pages build (expect=${expect || 'any'}, last_status=${lastStatus})`,
    lastBuild,
  );
}
