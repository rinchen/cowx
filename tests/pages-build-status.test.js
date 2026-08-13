import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  PagesBuildWaitError,
  classifyPagesBuild,
  diagnosePagesFailureText,
  findWedgedNonTipShas,
  isWedgedPagesDeploymentStatus,
  parseInProgressDeploymentBlocker,
  sameCommitSha,
  waitForPagesBuild,
} from '../scripts/ci/pages-build-status.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/pages-builds.json', import.meta.url), 'utf8'),
);

const PRIOR_WEDGE_SHA = 'b23f5971663e150a24ee7c7b0d6bcaa858c45788';

describe('parseInProgressDeploymentBlocker', () => {
  it('extracts the blocking SHA from a deploy-pages conflict', () => {
    const text =
      'Error: Failed to create deployment (status: 400) with build version abc. ' +
      'Responded with: Deployment request failed for 08174cf01bc0a893c1e7ab84844558056fde1a01 ' +
      'due to in progress deployment. Please cancel 1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6 first ' +
      'or wait for it to complete.';
    assert.equal(
      parseInProgressDeploymentBlocker(text),
      '1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6',
    );
  });

  it('returns null for unrelated failures', () => {
    assert.equal(parseInProgressDeploymentBlocker('Page build failed.'), null);
    assert.equal(parseInProgressDeploymentBlocker(''), null);
  });
});

describe('diagnosePagesFailureText', () => {
  it('marks lock conflicts as retryable with a blocker SHA', () => {
    const text =
      'due to in progress deployment. Please cancel 1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6 first';
    const d = diagnosePagesFailureText(text);
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, '1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6');
  });

  it('marks deploy-pages timeouts as retryable without a blocker SHA', () => {
    const d = diagnosePagesFailureText('Timeout reached, aborting!\nTimeout reached, aborting!');
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, null);
    assert.match(d.detail, /timeout/i);
  });

  it('marks Deployment cancelled annotations as retryable without a blocker SHA', () => {
    const d = diagnosePagesFailureText('##[error]Deployment cancelled.\n');
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, null);
    assert.match(d.detail, /cancelled/i);
  });

  it('marks Pages API 500 create-deployment errors as retryable', () => {
    const text =
      'Error: Failed to create deployment (status: 500) with build version ' +
      'a4df5b27fc7eeb6b08f14d85e746cd5c0a1162cd. Request ID ' +
      'FC20:1EDD18:CF6100:2BF0179:6A7DD646 Server error, is githubstatus.com ' +
      'reporting a Pages outage? Please re-run the deployment at a later time.';
    const d = diagnosePagesFailureText(text);
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, null);
    assert.match(d.detail, /5xx/i);
  });

  it('marks truncated Pages API 500 annotations as retryable', () => {
    const text =
      'Error: Failed to create deployment (status: 500) with build version ' +
      'a4df5b27fc7eeb6b08f14d85e746cd5c0a1162cd. Request ID ' +
      'FC20:1EDD18:CF6100:2BF0179:6A7DD646 Server error, is github';
    const d = diagnosePagesFailureText(text);
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, null);
  });

  it('marks Pages API 429 create-deployment errors as retryable', () => {
    const d = diagnosePagesFailureText(
      'Error: Failed to create deployment (status: 429) with build version abc.',
    );
    assert.equal(d.retryable, true);
    assert.equal(d.blockingSha, null);
  });

  it('does not treat 4xx create-deployment errors as API 5xx retries', () => {
    const d = diagnosePagesFailureText(
      'Error: Failed to create deployment (status: 400) with build version abc. ' +
        'No artifacts named "github-pages" were found for this workflow run.',
    );
    assert.equal(d.retryable, false);
  });

  it('marks unrelated failures as non-retryable', () => {
    const d = diagnosePagesFailureText('Page build failed.');
    assert.equal(d.retryable, false);
  });
});

describe('wedged non-tip Pages lock helpers', () => {
  it('sameCommitSha matches full SHAs and unique prefixes', () => {
    assert.equal(sameCommitSha(fixtures.expectedSha, fixtures.expectedSha), true);
    assert.equal(sameCommitSha(fixtures.expectedSha, fixtures.expectedSha.slice(0, 7)), true);
    assert.equal(sameCommitSha(fixtures.expectedSha, PRIOR_WEDGE_SHA), false);
    assert.equal(sameCommitSha('', fixtures.expectedSha), false);
  });

  it('isWedgedPagesDeploymentStatus recognizes in-progress shapes', () => {
    assert.equal(isWedgedPagesDeploymentStatus('deployment_in_progress'), true);
    assert.equal(isWedgedPagesDeploymentStatus('queued'), true);
    assert.equal(isWedgedPagesDeploymentStatus('pending'), true);
    assert.equal(isWedgedPagesDeploymentStatus('in_progress'), true);
    assert.equal(isWedgedPagesDeploymentStatus('succeed'), false);
    assert.equal(isWedgedPagesDeploymentStatus('failure'), false);
  });

  it('findWedgedNonTipShas excludes tip, finished statuses, and duplicates', () => {
    assert.deepEqual(
      findWedgedNonTipShas(fixtures.expectedSha, [
        { sha: fixtures.expectedSha, status: 'deployment_in_progress' },
        { sha: PRIOR_WEDGE_SHA, status: 'deployment_in_progress' },
        { sha: PRIOR_WEDGE_SHA, status: 'deployment_in_progress' },
        { sha: fixtures.unrelated.head_sha, status: 'succeed' },
        { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'queued' },
      ]),
      [PRIOR_WEDGE_SHA, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    );
  });
});

describe('GitHub Pages build polling', () => {
  it('succeeds for the expected built commit', async () => {
    const build = await waitForPagesBuild({
      fetchBuilds: async () => [fixtures.built],
      expect: fixtures.expectedSha,
      sleep: async () => {},
    });

    assert.equal(build.head_sha, fixtures.expectedSha);
  });

  it('fails immediately for an unsuccessful completed deployment', async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          fetchBuilds: async () => {
            calls += 1;
            return [fixtures.errored];
          },
          expect: fixtures.expectedSha,
          maxAttempts: 10,
          sleep: async () => {},
        }),
      (error) => {
        assert.ok(error instanceof PagesBuildWaitError);
        assert.equal(error.code, 'build_error');
        assert.match(error.message, /concluded cancelled/);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it('re-runs a cancelled pages-build-deployment then succeeds', async () => {
    const responses = [
      [fixtures.errored],
      [fixtures.errored],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {number[]} */
    const cleared = [];
    /** @type {number[]} */
    const reruns = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 2,
      rerunDelaySecs: 0,
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async (b) => {
        reruns.push(b.id);
      },
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    // Cancelled tip builds re-run without clearing the tip SHA.
    assert.deepEqual(cleared, []);
    assert.deepEqual(reruns, [fixtures.errored.id]);
    assert.ok(calls >= 4);
  });

  it('clears the blocker, waits, re-runs, then succeeds', async () => {
    const responses = [
      [fixtures.transientFailure],
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {number[]} */
    const rerunIds = [];
    /** @type {string[]} */
    const cleared = [];
    /** @type {number[]} */
    const sleeps = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunDelaySecs: 60,
      diagnoseFailure: async () => ({
        retryable: true,
        blockingSha: '1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6',
        detail: 'in-progress deployment conflict',
      }),
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async (b) => {
        rerunIds.push(b.id);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.equal(build.conclusion, 'success');
    assert.deepEqual(cleared, ['1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6']);
    assert.deepEqual(rerunIds, [fixtures.transientFailure.id]);
    assert.ok(sleeps.includes(60_000), 'expected rerun delay before re-run');
  });

  it('on timeout, re-runs without clearing the tip SHA', async () => {
    const responses = [
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {string[]} */
    const cleared = [];
    /** @type {number[]} */
    const reruns = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunDelaySecs: 0,
      diagnoseFailure: async () => ({
        retryable: true,
        blockingSha: null,
        detail: 'deploy-pages timeout',
      }),
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async (b) => {
        reruns.push(b.id);
      },
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    // Tip cancel after timeout races the next deploy into "Deployment cancelled."
    // Without a wedge finder, nothing is cleared.
    assert.deepEqual(cleared, []);
    assert.deepEqual(reruns, [fixtures.transientFailure.id]);
  });

  it('on timeout, clears wedged non-tip SHAs but never the tip', async () => {
    const responses = [
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {string[]} */
    const cleared = [];
    /** @type {Array<{ shas: string[], reason: string }>} */
    const clearLog = [];
    let wedgeScans = 0;

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunDelaySecs: 0,
      diagnoseFailure: async () => ({
        retryable: true,
        blockingSha: null,
        detail: 'deploy-pages timeout',
      }),
      findWedgedNonTipDeployments: async (tip) => {
        wedgeScans += 1;
        assert.equal(tip, fixtures.expectedSha);
        // Misreport tip as wedged too — waitForPagesBuild must still skip it.
        return [PRIOR_WEDGE_SHA, fixtures.expectedSha];
      },
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      onClearWedges: (details) => {
        clearLog.push(details);
      },
      rerunBuild: async () => {},
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    assert.ok(wedgeScans >= 2, 'expected preflight + rerun wedge scans');
    assert.deepEqual(cleared, [PRIOR_WEDGE_SHA, PRIOR_WEDGE_SHA]);
    assert.ok(!cleared.includes(fixtures.expectedSha));
    assert.deepEqual(
      clearLog.map((e) => e.reason),
      ['preflight', 'rerun'],
    );
  });

  it('preflight clears wedged non-tip locks before the first poll', async () => {
    /** @type {string[]} */
    const cleared = [];
    /** @type {string[]} */
    const reasons = [];
    let fetchCalls = 0;

    const build = await waitForPagesBuild({
      fetchBuilds: async () => {
        fetchCalls += 1;
        assert.deepEqual(cleared, [PRIOR_WEDGE_SHA], 'preflight must run before fetchBuilds');
        return [fixtures.built];
      },
      expect: fixtures.expectedSha,
      findWedgedNonTipDeployments: async () => [PRIOR_WEDGE_SHA],
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      onClearWedges: ({ reason }) => {
        reasons.push(reason);
      },
      sleep: async () => {},
    });

    assert.equal(build.head_sha, fixtures.expectedSha);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(cleared, [PRIOR_WEDGE_SHA]);
    assert.deepEqual(reasons, ['preflight']);
  });

  it('re-runs Deployment cancelled failures without clearing the tip', async () => {
    const responses = [
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {string[]} */
    const cleared = [];
    /** @type {number[]} */
    const reruns = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunDelaySecs: 0,
      diagnoseFailure: async () => diagnosePagesFailureText('##[error]Deployment cancelled.'),
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async (b) => {
        reruns.push(b.id);
      },
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    assert.deepEqual(cleared, []);
    assert.deepEqual(reruns, [fixtures.transientFailure.id]);
  });

  it('never clears the tip when diagnosis names it as the blocker', async () => {
    const responses = [
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {string[]} */
    const cleared = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunDelaySecs: 0,
      diagnoseFailure: async () => ({
        retryable: true,
        blockingSha: fixtures.expectedSha,
        detail: 'in-progress deployment conflict',
      }),
      findWedgedNonTipDeployments: async () => [],
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async () => {},
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    assert.deepEqual(cleared, []);
  });
  it('fails immediately when diagnosis is not retryable', async () => {
    let reruns = 0;
    let clears = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          fetchBuilds: async () => [fixtures.transientFailure],
          expect: fixtures.expectedSha,
          maxAttempts: 10,
          maxReruns: 3,
          diagnoseFailure: async () => ({
            retryable: false,
            detail: 'content build error',
          }),
          clearBlockingDeployment: async () => {
            clears += 1;
          },
          rerunBuild: async () => {
            reruns += 1;
          },
          sleep: async () => {},
        }),
      (error) => {
        assert.ok(error instanceof PagesBuildWaitError);
        assert.match(error.message, /content build error/);
        return true;
      },
    );
    assert.equal(reruns, 0);
    assert.equal(clears, 0);
  });

  it('fails when re-runs are exhausted', async () => {
    let calls = 0;
    let reruns = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          fetchBuilds: async () => {
            calls += 1;
            return [{ ...fixtures.transientFailure, run_attempt: calls }];
          },
          expect: fixtures.expectedSha,
          maxAttempts: 10,
          maxReruns: 2,
          rerunDelaySecs: 0,
          diagnoseFailure: async () => ({
            retryable: true,
            blockingSha: '1c6d6fd1dc1d58d7f4cf4b39fe6c1cae75d5bbe6',
          }),
          clearBlockingDeployment: async () => {},
          rerunBuild: async () => {
            reruns += 1;
          },
          sleep: async () => {},
        }),
      (error) => {
        assert.ok(error instanceof PagesBuildWaitError);
        assert.equal(error.code, 'build_error');
        assert.match(error.message, /concluded failure/);
        return true;
      },
    );
    assert.equal(reruns, 2);
  });

  it('times out after the bounded number of building responses', async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          fetchBuilds: async () => {
            calls += 1;
            return [fixtures.building];
          },
          expect: fixtures.expectedSha,
          maxAttempts: 3,
          sleepSecs: 5,
          sleep: async () => {},
        }),
      (error) => {
        assert.ok(error instanceof PagesBuildWaitError);
        assert.equal(error.code, 'timeout');
        assert.match(error.message, /~15s/);
        assert.match(error.message, /last_status=in_progress/);
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  it('ignores unrelated commits until the expected SHA appears', async () => {
    const responses = [[fixtures.unrelated], [fixtures.built, fixtures.unrelated]];
    let calls = 0;

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[calls++],
      expect: fixtures.expectedSha,
      maxAttempts: 2,
      sleep: async () => {},
    });

    assert.equal(calls, 2);
    assert.equal(build.head_sha, fixtures.expectedSha);
  });

  it('classifies a missing expected commit as pending', () => {
    assert.deepEqual(classifyPagesBuild([fixtures.unrelated], fixtures.expectedSha), {
      state: 'pending',
      status: 'not_found',
      error: '-',
      build: null,
    });
  });

  it('requests a Pages rebuild when the tip never gets a workflow run', async () => {
    const responses = [
      [fixtures.unrelated],
      [fixtures.unrelated],
      [fixtures.unrelated],
      [fixtures.building],
      [fixtures.built],
    ];
    let calls = 0;
    /** @type {string[]} */
    const requested = [];
    /** @type {number[]} */
    const requestLog = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      missingBuildRequestAfterAttempts: 3,
      maxMissingBuildRequests: 2,
      requestMissingBuild: async (sha) => {
        requested.push(sha);
      },
      onMissingBuildRequest: ({ requestsUsed }) => {
        requestLog.push(requestsUsed);
      },
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    assert.deepEqual(requested, [fixtures.expectedSha]);
    assert.deepEqual(requestLog, [1]);
  });

  it('does not request a missing build when expect is empty', async () => {
    let requests = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          fetchBuilds: async () => [],
          expect: '',
          maxAttempts: 5,
          missingBuildRequestAfterAttempts: 1,
          maxMissingBuildRequests: 2,
          requestMissingBuild: async () => {
            requests += 1;
          },
          sleep: async () => {},
        }),
      (error) => {
        assert.ok(error instanceof PagesBuildWaitError);
        assert.equal(error.code, 'timeout');
        return true;
      },
    );
    assert.equal(requests, 0);
  });
});
