import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { scanRepo, listCandidateFiles } from '../src/repo/scanner.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'tiny-repo');

test('scanRepo excludes node_modules and non-code files', () => {
  const scan = scanRepo(FIXTURE_ROOT);
  const relPaths = scan.allFiles.map((f) => f.relPath);

  assert.ok(!relPaths.some((p) => p.includes('node_modules')), 'node_modules must be excluded');
  assert.ok(!relPaths.some((p) => p.endsWith('.png')), 'non-code files must be excluded');
});

test('scanRepo marks files under test/ as test files', () => {
  const scan = scanRepo(FIXTURE_ROOT);
  const testFile = scan.allFiles.find((f) => f.relPath.includes('some.test.js'));
  assert.ok(testFile, 'fixture test file should be scanned');
  assert.equal(testFile!.isTest, true);
});

test('listCandidateFiles excludes test files, keeps production files', () => {
  const scan = scanRepo(FIXTURE_ROOT);
  const candidates = listCandidateFiles(scan);

  assert.ok(candidates.includes('src/math.js'));
  assert.ok(candidates.includes('src/utils/dates.js'));
  assert.ok(!candidates.some((p) => p.includes('test/')));
});

test('scanRepo extracts symbols for production files', () => {
  const scan = scanRepo(FIXTURE_ROOT);
  const mathSymbols = scan.fileSymbols.get('src/math.js');
  assert.ok(mathSymbols);
  assert.ok(mathSymbols!.functions.some((f) => f.name === 'add'));
  assert.ok(mathSymbols!.functions.some((f) => f.name === 'subtract'));
});
