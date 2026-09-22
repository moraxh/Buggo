import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { investigateV3 } from '../src/investigation/investigate-v3.js';
import type { DecisionEngine } from '../src/providers/jev/decision-engine.js';
import { FakeJevClient } from './fakes/fake-jev-client.js';

function makeLargeRepo(fileCount: number): string {
  const root = mkdtempSync(join(tmpdir(), 'buggo-large-repo-'));
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(root, 'src', `module${i}.js`), `export function fn${i}() { return ${i}; }\n`);
  }
  // Plant the "real" culprit somewhere in the middle, not at index 0 - a
  // naive prefilter over lexical order would likely still find index 0,
  // so this specifically exercises whether chunking covers every candidate.
  writeFileSync(join(root, 'src', 'the-culprit.js'), `export function brokenLogic() { return null; }\n`);
  writeFileSync(join(root, 'package.json'), '{}');
  return root;
}

test('investigateV3 chunked path gives every candidate a real judgment (no prefilter loss)', async () => {
  const root = makeLargeRepo(60); // > config.maxCandidateFiles (40), forces chunking
  try {
    const fake = new FakeJevClient({
      pickWinner: (req) => {
        const criteria = (Object.values(req.questions)[0] as any).criteria as Record<string, string | null>;
        const culpritKey = Object.keys(criteria).find((k) => k.includes('the-culprit.js'));
        // Only "win" within whichever chunk actually contains the culprit;
        // other chunks fall back to their first option.
        return culpritKey ?? Object.keys(criteria)[0];
      },
    });

    const result = await investigateV3(
      fake as unknown as DecisionEngine,
      { bug_id: 'test-bug-large', bug_description: 'brokenLogic returns null unexpectedly', error_message: null, stack_trace: null },
      root
    );

    assert.equal(result.usedChunking, true);
    assert.ok(result.chunkCount >= 2);
    assert.equal(result.fileRanking[0].file, 'src/the-culprit.js', 'chunking must not lose the correct file to a prefilter');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
