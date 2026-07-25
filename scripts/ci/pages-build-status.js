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
 * @param {Record<string, unknown>[]} builds
 * @param {string} expect
 * @returns {Record<string, unknown> | null}
 */
export function findExpectedBuild(builds, expect) {
  if (!expect) return builds[0] ?? null;
  const prefix = expect.slice(0, 7);
  return (
    builds.find((build) => {
      const commit = typeof build.head_sha === 'string' ? build.head_sha : '';
      return commit === expect || commit.startsWith(prefix);
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
 *   rerunBuild?: (build: Record<string, unknown>) => Promise<void>,
 *   maxReruns?: number,
 *   rerunDelaySecs?: number,
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
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function waitForPagesBuild(options) {
  const expect = options.expect ?? '';
  const maxAttempts = options.maxAttempts ?? 180;
  const sleepSecs = options.sleepSecs ?? 5;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const onAttempt = options.onAttempt ?? (() => {});
  const onRerun = options.onRerun ?? (() => {});
  const diagnoseFailure = options.diagnoseFailure ?? null;
  const clearBlockingDeployment = options.clearBlockingDeployment ?? null;
  const rerunBuild = options.rerunBuild ?? null;
  const maxReruns = options.maxReruns ?? 0;
  const rerunDelaySecs = options.rerunDelaySecs ?? 60;

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

  let lastStatus = 'not_found';
  let lastBuild = null;
  let rerunsUsed = 0;
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
      const build = /** @type {Record<string, unknown>} */ (result.build);
      const key = buildAttemptKey(build);
      // A re-run was already triggered for this attempt; wait for GitHub to
      // restart it (a new run_attempt) rather than failing on the stale result.
      if (rerunTriggered.has(key) && attempt < maxAttempts) {
        await sleep(sleepSecs * 1000);
        continue;
      }

      /** @type {PagesFailureDiagnosis} */
      let diagnosis = { retryable: Boolean(rerunBuild && maxReruns > 0) };
      if (diagnoseFailure) {
        diagnosis = await diagnoseFailure(build);
      }

      if (diagnosis.retryable && rerunBuild && rerunsUsed < maxReruns && !rerunTriggered.has(key)) {
        rerunTriggered.add(key);
        rerunsUsed += 1;
        const blockingSha = diagnosis.blockingSha ?? null;
        if (blockingSha && clearBlockingDeployment) {
          await clearBlockingDeployment(blockingSha);
        }
        onRerun({
          rerunsUsed,
          maxReruns,
          build,
          blockingSha,
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
    if (attempt < maxAttempts) await sleep(sleepSecs * 1000);
  }

  const budgetSecs = maxAttempts * sleepSecs;
  throw new PagesBuildWaitError(
    'timeout',
    `Timed out after ~${budgetSecs}s waiting for GitHub Pages build (expect=${expect || 'any'}, last_status=${lastStatus})`,
    lastBuild,
  );
}
