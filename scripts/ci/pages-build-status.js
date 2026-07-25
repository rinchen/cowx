/**
 * Testable GitHub Pages deployment-workflow polling state machine.
 *
 * GitHub's legacy /pages/builds endpoint can report "Page build failed" while
 * the canonical dynamic/pages/pages-build-deployment workflow succeeds and
 * publishes the CDN. Use the workflow run as the source of truth.
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
 * @param {{
 *   fetchBuilds: () => Promise<Record<string, unknown>[]>,
 *   expect?: string,
 *   maxAttempts?: number,
 *   sleepSecs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   onAttempt?: (details: {
 *     attempt: number,
 *     maxAttempts: number,
 *     status: string,
 *     error: string,
 *     build: Record<string, unknown> | null,
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

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(sleepSecs) || sleepSecs < 0) {
    throw new TypeError('sleepSecs must be a non-negative number');
  }

  let lastStatus = 'not_found';
  let lastBuild = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const builds = await options.fetchBuilds();
    const result = classifyPagesBuild(builds, expect);
    lastStatus = result.status;
    lastBuild = result.build;
    onAttempt({ attempt, maxAttempts, ...result });

    if (result.state === 'success') return /** @type {Record<string, unknown>} */ (result.build);
    if (result.state === 'error') {
      const commit = String(result.build?.head_sha ?? '').slice(0, 7) || 'unknown';
      throw new PagesBuildWaitError(
        'build_error',
        `GitHub Pages deployment failed for ${commit}: ${result.error}`,
        result.build,
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
