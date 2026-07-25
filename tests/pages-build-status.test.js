import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  PagesBuildWaitError,
  classifyPagesBuild,
  waitForPagesBuild,
} from '../scripts/ci/pages-build-status.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/pages-builds.json', import.meta.url), 'utf8'),
);

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

  it('re-runs a transient deploy failure and succeeds once GitHub restarts it', async () => {
    // failure -> (re-run triggered) -> stale failure while restart pends -> in_progress -> success
    const responses = [
      [fixtures.transientFailure],
      [fixtures.transientFailure],
      [fixtures.rerunInProgress],
      [fixtures.rerunSucceeded],
    ];
    let calls = 0;
    /** @type {number[]} */
    const rerunIds = [];

    const build = await waitForPagesBuild({
      fetchBuilds: async () => responses[Math.min(calls++, responses.length - 1)],
      expect: fixtures.expectedSha,
      maxAttempts: 10,
      maxReruns: 3,
      rerunBuild: async (b) => {
        rerunIds.push(b.id);
      },
      sleep: async () => {},
    });

    assert.equal(build.conclusion, 'success');
    // Exactly one re-run for the single failed attempt (run_attempt 1).
    assert.deepEqual(rerunIds, [fixtures.transientFailure.id]);
  });

  it('fails when re-runs are exhausted', async () => {
    let calls = 0;
    let reruns = 0;

    await assert.rejects(
      () =>
        waitForPagesBuild({
          // Each poll shows a brand-new failed attempt (run_attempt increments),
          // so every one is eligible for a fresh re-run until the budget runs out.
          fetchBuilds: async () => {
            calls += 1;
            return [{ ...fixtures.transientFailure, run_attempt: calls }];
          },
          expect: fixtures.expectedSha,
          maxAttempts: 10,
          maxReruns: 2,
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
});
