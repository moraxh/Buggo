import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { investigateV3 } from '../src/investigation/investigate-v3.js';
import type { DecisionEngine } from '../src/providers/jev/decision-engine.js';
import { FakeJevClient } from './fakes/fake-jev-client.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'tiny-repo');

test('investigateV3 direct (unchunked) localization returns a ranked file with symbols', async () => {
  const fake = new FakeJevClient({
    pickWinner: (req) => {
      const criteria = (Object.values(req.questions)[0] as any).criteria as Record<string, string | null>;
      // Always pick the option whose criteria mentions "add" (src/math.js), when present.
      const mathKey = Object.keys(criteria).find((k) => k.includes('math.js'));
      return mathKey ?? Object.keys(criteria)[0];
    },
  });

  const result = await investigateV3(
    fake as unknown as DecisionEngine,
    { bug_id: 'test-bug', bug_description: 'add() returns wrong sum', error_message: null, stack_trace: null, hinted_files: [] },
    FIXTURE_ROOT
  );

  assert.equal(result.usedChunking, false, 'tiny fixture repo must not trigger chunking');
  assert.ok(result.fileRanking.length > 0);
  assert.equal(result.fileRanking[0].file, 'src/math.js');
  assert.ok(result.fileRanking[0].probability > 0);
});

test('investigateV3 never fabricates a candidate outside the scanned repo', async () => {
  const fake = new FakeJevClient({ pickWinner: (req) => Object.keys((Object.values(req.questions)[0] as any).criteria)[0] });

  const result = await investigateV3(
    fake as unknown as DecisionEngine,
    { bug_id: 'test-bug-2', bug_description: 'something broke', error_message: null, stack_trace: null, hinted_files: [] },
    FIXTURE_ROOT
  );

  const scannedFiles = new Set(result.scan.allFiles.filter((f) => !f.isTest).map((f) => f.relPath));
  for (const r of result.fileRanking) {
    assert.ok(scannedFiles.has(r.file), `ranked file ${r.file} must come from the actual scan`);
  }
});

test('investigateV3 excludes files passed in excludedFiles from the candidate pool entirely', async () => {
  const fake = new FakeJevClient({ pickWinner: (req) => Object.keys((Object.values(req.questions)[0] as any).criteria)[0] });

  const result = await investigateV3(
    fake as unknown as DecisionEngine,
    { bug_id: 'test-bug-exclude', bug_description: 'add() returns wrong sum', error_message: null, stack_trace: null, hinted_files: [] },
    FIXTURE_ROOT,
    ['src/math.js']
  );

  assert.ok(
    !result.fileRanking.some((r) => r.file === 'src/math.js'),
    'excluded file must never appear in the ranking'
  );
  assert.ok(result.fileRanking.length > 0, 'other candidates are still ranked');
});

test('investigateV3 surfaces stack trace matches as evidence via stackTraceMatches', async () => {
  const fake = new FakeJevClient({ pickWinner: (req) => Object.keys((Object.values(req.questions)[0] as any).criteria)[0] });

  const result = await investigateV3(
    fake as unknown as DecisionEngine,
    {
      bug_id: 'test-bug-stack',
      bug_description: 'add() returns wrong sum',
      error_message: null,
      stack_trace: 'at add (src/math.js:5:3)',
      hinted_files: [],
    },
    FIXTURE_ROOT
  );

  assert.ok(result.stackTraceMatches.has('src/math.js'));
});

test('investigateV3 surfaces caller-hinted files as evidence via hintedFileMatches', async () => {
  const fake = new FakeJevClient({ pickWinner: (req) => Object.keys((Object.values(req.questions)[0] as any).criteria)[0] });

  const result = await investigateV3(
    fake as unknown as DecisionEngine,
    {
      bug_id: 'test-bug-hinted',
      bug_description: 'add() returns wrong sum',
      error_message: null,
      stack_trace: null,
      hinted_files: ['src/math.js'],
    },
    FIXTURE_ROOT
  );

  assert.ok(result.hintedFileMatches.has('src/math.js'));
});
