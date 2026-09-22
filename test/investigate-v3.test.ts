import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { investigateV3 } from '../src/investigation/investigate-v3.js';
import type { JevClient } from '../src/jev/client.js';
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
    fake as unknown as JevClient,
    { bug_id: 'test-bug', bug_description: 'add() returns wrong sum', error_message: null, stack_trace: null },
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
    fake as unknown as JevClient,
    { bug_id: 'test-bug-2', bug_description: 'something broke', error_message: null, stack_trace: null },
    FIXTURE_ROOT
  );

  const scannedFiles = new Set(result.scan.allFiles.filter((f) => !f.isTest).map((f) => f.relPath));
  for (const r of result.fileRanking) {
    assert.ok(scannedFiles.has(r.file), `ranked file ${r.file} must come from the actual scan`);
  }
});
