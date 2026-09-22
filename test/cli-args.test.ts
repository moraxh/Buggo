import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInvestigateArgs, parseFormatFlag, ArgsError } from '../src/interfaces/cli/args.js';

test('parseInvestigateArgs requires a description', () => {
  assert.throws(() => parseInvestigateArgs([]), ArgsError);
  assert.throws(() => parseInvestigateArgs(['--format', 'json']), ArgsError);
});

test('parseInvestigateArgs parses description and flags', () => {
  const args = parseInvestigateArgs([
    'checkout fails when cart is empty',
    '--error',
    'TypeError: cannot read x',
    '--test',
    'test/checkout.spec.js',
    '--repo',
    '/some/repo',
    '--format',
    'json',
  ]);
  assert.equal(args.description, 'checkout fails when cart is empty');
  assert.equal(args.errorMessage, 'TypeError: cannot read x');
  assert.equal(args.failingTest, 'test/checkout.spec.js');
  assert.equal(args.repoRoot, '/some/repo');
  assert.equal(args.format, 'json');
});

test('parseInvestigateArgs defaults format to human and repoRoot to cwd', () => {
  const args = parseInvestigateArgs(['a bug happened']);
  assert.equal(args.format, 'human');
  assert.equal(args.repoRoot, process.cwd());
});

test('parseInvestigateArgs rejects an invalid --format value', () => {
  assert.throws(() => parseInvestigateArgs(['a bug', '--format', 'xml']), ArgsError);
});

test('parseInvestigateArgs treats --stack as literal text when it is not an existing file path', () => {
  const args = parseInvestigateArgs(['a bug', '--stack', 'Error: boom\n  at foo (bar.js:1:1)']);
  assert.equal(args.stackTrace, 'Error: boom\n  at foo (bar.js:1:1)');
});

test('parseInvestigateArgs reads --stack from a file when the path exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-args-'));
  const stackPath = join(dir, 'stack.txt');
  writeFileSync(stackPath, 'Error: from file\n  at real (real.js:2:2)');
  try {
    const args = parseInvestigateArgs(['a bug', '--stack', stackPath]);
    assert.equal(args.stackTrace, 'Error: from file\n  at real (real.js:2:2)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseInvestigateArgs rejects an unexpected extra positional argument', () => {
  assert.throws(() => parseInvestigateArgs(['a bug', 'an unexpected extra arg']), ArgsError);
});

test('parseFormatFlag defaults to human, accepts human/json, rejects anything else', () => {
  assert.equal(parseFormatFlag([]), 'human');
  assert.equal(parseFormatFlag(['--format', 'human']), 'human');
  assert.equal(parseFormatFlag(['--format', 'json']), 'json');
  assert.throws(() => parseFormatFlag(['--format', 'xml']), ArgsError);
});

test('parseFormatFlag throws (does not silently fall back to human) when --format has no value', () => {
  // Regression: buggo show's own ad-hoc --format handling used to silently
  // render human output for `buggo show <id> --format` (missing value) or
  // any typo'd value instead of erroring - readFlagValue already throws for
  // a missing value, parseFormatFlag must propagate that, not swallow it.
  assert.throws(() => parseFormatFlag(['--format']), ArgsError);
});

test('parseInvestigateArgs collects every --exclude occurrence, not just the first', () => {
  const args = parseInvestigateArgs(['a bug', '--exclude', 'src/a.ts', '--exclude', 'src/b.ts']);
  assert.deepEqual(args.excludedFiles, ['src/a.ts', 'src/b.ts']);
});

test('parseInvestigateArgs defaults excludedFiles to an empty array when --exclude is absent', () => {
  const args = parseInvestigateArgs(['a bug']);
  assert.deepEqual(args.excludedFiles, []);
});

test('parseInvestigateArgs parses --diff and --recent-changes', () => {
  const args = parseInvestigateArgs(['a bug', '--diff', 'HEAD~3', '--recent-changes', '5']);
  assert.equal(args.diffRef, 'HEAD~3');
  assert.equal(args.recentChangesCount, 5);
});

test('parseInvestigateArgs rejects a non-positive-integer --recent-changes', () => {
  assert.throws(() => parseInvestigateArgs(['a bug', '--recent-changes', '0']), ArgsError);
  assert.throws(() => parseInvestigateArgs(['a bug', '--recent-changes', 'abc']), ArgsError);
});
