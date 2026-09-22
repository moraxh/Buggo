import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStackTracePaths, matchStackTraceToCandidates } from '../src/investigation/stack-trace.js';

test('extractStackTracePaths finds JS/TS frame paths', () => {
  const stack = `TypeError: Cannot read properties of undefined
    at requestProfilePictureUploadURL (app/src/modules/user/profile-picture/profile-picture.service.ts:42:11)
    at async handler (app/src/api/router.ts:15:3)`;
  const paths = extractStackTracePaths(stack);
  assert.ok(paths.includes('app/src/modules/user/profile-picture/profile-picture.service.ts'));
  assert.ok(paths.includes('app/src/api/router.ts'));
});

test('extractStackTracePaths finds Python traceback paths', () => {
  const stack = `Traceback (most recent call last):
  File "app/scrapers/dicis_salamanca.py", line 88, in scrape_courses
    raise ValueError("no section found")
ValueError: no section found`;
  const paths = extractStackTracePaths(stack);
  assert.ok(paths.includes('app/scrapers/dicis_salamanca.py'));
});

test('extractStackTracePaths returns no paths for prose with no file references', () => {
  const paths = extractStackTracePaths('Something went wrong, not sure what.');
  assert.deepEqual(paths, []);
});

test('extractStackTracePaths deduplicates repeated frames', () => {
  const stack = `at foo (src/a.ts:1:1)\nat bar (src/a.ts:1:1)\nat baz (src/b.ts:2:2)`;
  const paths = extractStackTracePaths(stack);
  assert.equal(paths.filter((p) => p === 'src/a.ts').length, 1);
});

test('matchStackTraceToCandidates matches by exact and suffix path', () => {
  const stack = 'at foo (src/utils/dates.js:10:2)';
  const candidates = ['src/utils/dates.js', 'src/math.js', 'test/some.test.js'];
  const matched = matchStackTraceToCandidates(stack, candidates);
  assert.deepEqual(matched, ['src/utils/dates.js']);
});

test('matchStackTraceToCandidates returns empty when nothing in the stack matches a real candidate', () => {
  const stack = 'at foo (some/unrelated/path.js:1:1)';
  const candidates = ['src/math.js'];
  assert.deepEqual(matchStackTraceToCandidates(stack, candidates), []);
});

test('matchStackTraceToCandidates handles a stack trace with an absolute path prefix', () => {
  const stack = 'at foo (/home/user/repo/src/math.js:5:1)';
  const candidates = ['src/math.js'];
  assert.deepEqual(matchStackTraceToCandidates(stack, candidates), ['src/math.js']);
});
