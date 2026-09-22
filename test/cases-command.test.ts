import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeCase } from './fakes/fake-case.js';

async function withTempCwd<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-cases-command-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function captureStderr(fn: () => number): { exitCode: number; stderr: string } {
  const original = console.error;
  let stderr = '';
  console.error = (...args: unknown[]) => {
    stderr += args.join(' ') + '\n';
  };
  try {
    const exitCode = fn();
    return { exitCode, stderr };
  } finally {
    console.error = original;
  }
}

test('runShowCommand reports a usage error (not "no such case") when the caseId is omitted and only a flag is given', async () => {
  await withTempCwd(async () => {
    const { runShowCommand } = await import('../src/interfaces/cli/cases-command.js?t=' + Date.now());
    // Regression test: `buggo show --format json` (caseId omitted by
    // mistake) used to treat "json" (the flag's own value) as the caseId,
    // via a naive "first token not starting with -" filter, and reported
    // "No such case: json" instead of a clear missing-argument error.
    const { exitCode, stderr } = captureStderr(() => runShowCommand(['--format', 'json']));
    assert.equal(exitCode, 2);
    assert.match(stderr, /Usage: buggo show/);
    assert.doesNotMatch(stderr, /No such case/);
  });
});

test('runShowCommand still finds the caseId when it precedes --format', async () => {
  await withTempCwd(async () => {
    const { saveCase } = await import('../src/storage/case-store.js?t=' + Date.now());
    const { runShowCommand } = await import('../src/interfaces/cli/cases-command.js?t=' + Date.now());
    saveCase(makeFakeCase({ caseId: 'BG-0001' }));

    const exitCode = runShowCommand(['BG-0001', '--format', 'json']);
    assert.equal(exitCode, 0);
  });
});

test('runShowCommand rejects an unexpected extra positional argument', async () => {
  await withTempCwd(async () => {
    const { runShowCommand } = await import('../src/interfaces/cli/cases-command.js?t=' + Date.now());
    const { exitCode, stderr } = captureStderr(() => runShowCommand(['BG-0001', 'unexpected-extra']));
    assert.equal(exitCode, 2);
    assert.match(stderr, /Unexpected extra argument/);
  });
});
