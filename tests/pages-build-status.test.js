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

    assert.equal(build.commit, fixtures.expectedSha);
  });

  it('fails immediately for the expected errored commit', async () => {
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
        assert.match(error.message, /Page build failed/);
        return true;
      },
    );
    assert.equal(calls, 1);
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
        assert.match(error.message, /last_status=building/);
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
    assert.equal(build.commit, fixtures.expectedSha);
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
