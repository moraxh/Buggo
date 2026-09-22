import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeCase } from './fakes/fake-case.js';

/**
 * case-store.ts resolves .buggo/cases relative to process.cwd(), so each
 * test runs inside its own temp directory to avoid touching this package's
 * own working tree and to avoid cross-test interference.
 */
async function withTempCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-case-store-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('saveCase then loadCase round-trips the full Case', async () => {
  await withTempCwd(async () => {
    const { saveCase, loadCase } = await import('../src/storage/case-store.js?t=' + Date.now());
    const kase = makeFakeCase({ caseId: 'BG-0042' });
    saveCase(kase);

    const loaded = loadCase('BG-0042');
    assert.ok(loaded);
    assert.equal(loaded!.caseId, 'BG-0042');
    assert.equal(loaded!.localization?.suspects[0].path, 'src/broken.js');
  });
});

test('loadCase returns null for a case that does not exist', async () => {
  await withTempCwd(async () => {
    const { loadCase } = await import('../src/storage/case-store.js?t=' + Date.now());
    assert.equal(loadCase('BG-9999'), null);
  });
});

test('listCases returns an empty array when no cases have been saved', async () => {
  await withTempCwd(async () => {
    const { listCases } = await import('../src/storage/case-store.js?t=' + Date.now());
    assert.deepEqual(listCases(), []);
  });
});

test('listCases summarizes saved cases including top suspect', async () => {
  await withTempCwd(async () => {
    const { saveCase, listCases } = await import('../src/storage/case-store.js?t=' + Date.now());
    saveCase(makeFakeCase({ caseId: 'BG-0001' }));
    saveCase(makeFakeCase({ caseId: 'BG-0002', localization: null, status: 'FAILED' }));

    const summaries = listCases();
    assert.equal(summaries.length, 2);
    const first = summaries.find((s) => s.caseId === 'BG-0001')!;
    assert.equal(first.topSuspect, 'src/broken.js');
    const second = summaries.find((s) => s.caseId === 'BG-0002')!;
    assert.equal(second.topSuspect, null);
  });
});

test('saveCase removes the id-allocation lock file it claimed', async () => {
  await withTempCwd(async () => {
    const { saveCase } = await import('../src/storage/case-store.js?t=' + Date.now());
    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    mkdirSync(join('.buggo', 'cases'), { recursive: true });
    writeFileSync(join('.buggo', 'cases', 'BG-0001.lock'), '');

    saveCase(makeFakeCase({ caseId: 'BG-0001' }));

    assert.equal(existsSync(join('.buggo', 'cases', 'BG-0001.lock')), false);
  });
});

test('listCases({ limit }) reads only the N most recent case files, not the whole history', async () => {
  await withTempCwd(async () => {
    const { saveCase, listCases } = await import('../src/storage/case-store.js?t=' + Date.now());
    for (let i = 1; i <= 5; i++) {
      saveCase(makeFakeCase({ caseId: `BG-${String(i).padStart(4, '0')}` }));
    }

    const limited = listCases({ limit: 2 });
    assert.deepEqual(
      limited.map((c) => c.caseId),
      ['BG-0004', 'BG-0005']
    );

    const all = listCases();
    assert.equal(all.length, 5);
  });
});
