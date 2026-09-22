import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextCaseId } from '../src/core/case-id.js';

async function withTempCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-case-id-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('nextCaseId issues sequential, unique ids when called concurrently before any case is saved', async () => {
  await withTempCwd(async () => {
    // Regression test: the previous implementation read the existing-file
    // count and returned count+1 with no lock, so two callers racing before
    // either had persisted a case file both got the same id. Calling
    // nextCaseId() concurrently (no saveCase() in between, exactly the
    // race window) must still produce distinct ids.
    const ids = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve(nextCaseId())));
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `expected 10 unique ids, got: ${ids.join(', ')}`);
  });
});

test('nextCaseId returns BG-0001 first, then BG-0002 once a case file actually exists', async () => {
  await withTempCwd(async () => {
    const first = nextCaseId();
    assert.equal(first, 'BG-0001');

    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join('.buggo', 'cases'), { recursive: true });
    writeFileSync(join('.buggo', 'cases', `${first}.json`), '{}');

    const second = nextCaseId();
    assert.equal(second, 'BG-0002');
  });
});

test('nextCaseId propagates a non-collision error (e.g. permission denied) instead of spinning forever', async () => {
  await withTempCwd(async () => {
    const { mkdirSync, chmodSync } = await import('node:fs');
    const casesDir = join('.buggo', 'cases');
    mkdirSync(casesDir, { recursive: true });
    chmodSync(casesDir, 0o444); // read-only: every openSync(..., 'wx') inside will fail with EACCES, not EEXIST

    try {
      // Regression test: the previous implementation caught every openSync
      // failure and treated it as "id taken, try the next one" with no
      // upper bound, so a persistent non-collision failure (like this one)
      // spun forever instead of throwing. This must reject promptly.
      assert.throws(() => nextCaseId());
    } finally {
      chmodSync(casesDir, 0o755); // restore so the temp dir can be cleaned up
    }
  });
});
