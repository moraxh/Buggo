import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAgentResult, toAgentJsonString } from '../src/interfaces/json/format.js';
import { makeFakeCase } from './fakes/fake-case.js';

test('toAgentJsonString produces parseable, stable-shaped JSON', () => {
  const kase = makeFakeCase();
  const str = toAgentJsonString(kase);
  const parsed = JSON.parse(str);

  assert.equal(parsed.schemaVersion, '1');
  assert.equal(parsed.caseId, 'BG-0001');
  assert.equal(parsed.status, 'LOCALIZED');
  assert.equal(parsed.suspects[0].path, 'src/broken.js');
  assert.ok(Array.isArray(parsed.recommendedNextActions));
  assert.ok(parsed.recommendedNextActions.length > 0);
});

test('toAgentResult never fabricates evidence not present on the domain Suspect', () => {
  const kase = makeFakeCase();
  const result = toAgentResult(kase);
  assert.deepEqual(
    result.suspects[0].evidence.map((e) => e.type),
    ['symbol_match', 'model_decision']
  );
});

test('toAgentResult on a FAILED case has no suspects and a non-empty next action', () => {
  const kase = makeFakeCase({
    status: 'FAILED',
    localization: null,
    error: { message: 'Repository scan failed', stage: 'scan' },
  });
  const result = toAgentResult(kase);
  assert.equal(result.suspects.length, 0);
  assert.equal(result.error?.message, 'Repository scan failed');
  assert.ok(result.recommendedNextActions.length > 0);
});

test('toAgentResult maps optional BugReport fields to explicit null, never undefined', () => {
  const kase = makeFakeCase({ report: { description: 'x' } });
  const result = toAgentResult(kase);
  assert.equal(result.report.errorMessage, null);
  assert.equal(result.report.stackTrace, null);
  assert.equal(result.report.failingTest, null);
});
