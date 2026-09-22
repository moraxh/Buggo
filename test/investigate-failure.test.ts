import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { investigate } from '../src/core/investigate.js';

/**
 * Exercises the real FAILED path end-to-end (no Jev calls needed to hit
 * it): an empty repository has zero candidate files, so the pipeline's
 * choice question ends up with no options and the underlying client call
 * throws before ever reaching the network.
 */
async function withTempCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-investigate-failure-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('investigate() on an empty repository returns a FAILED case, never throws', async () => {
  await withTempCwd(async () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), 'buggo-empty-repo-'));
    try {
      const kase = await investigate({
        repoRoot: emptyRepo,
        report: { description: 'something is broken' },
      });

      assert.equal(kase.status, 'FAILED');
      assert.equal(kase.localization, null);
      assert.ok(kase.error);
      assert.ok(kase.error!.message.length > 0);
      assert.notEqual(kase.repository.productionFileCount, undefined);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });
});
