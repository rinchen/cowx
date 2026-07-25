/**
 * Testable GitHub Pages build polling state machine.
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
      const commit = typeof build.commit === 'string' ? build.commit : '';
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
  const rawError =
    build.error && typeof build.error === 'object'
      ? /** @type {{ message?: unknown }} */ (build.error).message
      : null;
  const error = rawError != null && String(rawError) ? String(rawError) : '-';

  if (status === 'built') return { state: 'success', status, error, build };
  if (status === 'errored') return { state: 'error', status, error, build };
  return { state: 'pending', status, error, build };
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
      const commit = String(result.build?.commit ?? '').slice(0, 7) || 'unknown';
      throw new PagesBuildWaitError(
        'build_error',
        `GitHub Pages build failed for ${commit}: ${result.error}`,
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
