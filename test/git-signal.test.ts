import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitRecency, describeRecency } from '../src/repo/git-signal.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-git-signal-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
}

test('getGitRecency returns 0 days for a file committed today', () => {
  const dir = makeTempGitRepo();
  try {
    writeFileSync(join(dir, 'foo.ts'), 'export const x = 1;');
    git(dir, 'add', 'foo.ts');
    git(dir, 'commit', '-q', '-m', 'add foo');

    const recency = getGitRecency(dir);
    assert.equal(recency.get('foo.ts'), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitRecency has no entry for a file that was never committed', () => {
  const dir = makeTempGitRepo();
  try {
    writeFileSync(join(dir, 'foo.ts'), 'export const x = 1;');
    git(dir, 'add', 'foo.ts');
    git(dir, 'commit', '-q', '-m', 'add foo');
    writeFileSync(join(dir, 'bar.ts'), 'export const y = 2;'); // never committed

    const recency = getGitRecency(dir);
    assert.equal(recency.has('bar.ts'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getGitRecency returns an empty map for a non-git directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-not-git-'));
  try {
    writeFileSync(join(dir, 'foo.ts'), 'export const x = 1;');
    const recency = getGitRecency(dir);
    assert.equal(recency.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describeRecency phrases days into human-readable buckets', () => {
  assert.equal(describeRecency(0), 'modified today');
  assert.equal(describeRecency(1), 'modified yesterday');
  assert.equal(describeRecency(3), 'modified 3 days ago');
  assert.equal(describeRecency(14), 'modified 2 weeks ago');
  assert.equal(describeRecency(60), 'modified 2 months ago');
  assert.equal(describeRecency(400), 'modified over a year ago');
});
