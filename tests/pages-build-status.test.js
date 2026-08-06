import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  PagesBuildWaitError,
  classifyPagesBuild,
  diagnosePagesFailureText,
  parseInProgressDeploymentBlocker,
  waitForPagesBuild,
} from '../scripts/ci/pages-build-status.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/pages-builds.json', import.meta.url), 'utf8'),
);

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

  it('marks unrelated failures as non-retryable', () => {
    const d = diagnosePagesFailureText('Page build failed.');
    assert.equal(d.retryable, false);
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
    assert.deepEqual(cleared, [fixtures.expectedSha]);
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

  it('on timeout, clears the tip SHA then re-runs', async () => {
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
        blockingSha: null,
        detail: 'deploy-pages timeout',
      }),
      clearBlockingDeployment: async (sha) => {
        cleared.push(sha);
      },
      rerunBuild: async () => {},
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    // No blocker SHA from diagnosis → clear the failed tip itself.
    assert.deepEqual(cleared, [fixtures.transientFailure.head_sha]);
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
