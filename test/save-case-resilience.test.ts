import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { investigate } from '../src/core/investigate.js';
import { makeFakeCase } from './fakes/fake-case.js';

async function withTempCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-save-resilience-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('saveCase throws when .buggo/cases cannot be created (blocked by a same-named file)', async () => {
  await withTempCwd(async () => {
    const { saveCase } = await import('../src/storage/case-store.js?t=' + Date.now());
    const { mkdirSync } = await import('node:fs');
    mkdirSync('.buggo', { recursive: true });
    // Put a regular file where the "cases" directory needs to go, so
    // mkdirSync(CASES_DIR, { recursive: true }) fails inside saveCase.
    writeFileSync(join('.buggo', 'cases'), 'not a directory');

    assert.throws(() => saveCase(makeFakeCase({ caseId: 'BG-0001' })));
  });
});

test('investigate() still returns the Case (does not throw) when persistence fails', async () => {
  await withTempCwd(async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync('.buggo', { recursive: true });
    writeFileSync(join('.buggo', 'cases'), 'not a directory');

    // An empty repo makes investigateV3 itself fail fast (no live Jev call,
    // no API key needed) - what this test actually exercises is that the
    // *separate* saveCase() failure (blocked cases dir, set up above) is
    // caught and logged rather than propagated past investigate()'s return.
    const emptyRepo = mkdtempSync(join(tmpdir(), 'buggo-empty-repo-'));
    try {
      const kase = await investigate({ repoRoot: emptyRepo, report: { description: 'x' } });
      assert.equal(kase.status, 'FAILED');
      assert.ok(kase.error);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });
});
