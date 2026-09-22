import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { investigateV3 } from '../src/investigation/investigate-v3.js';
import { BugBudgetExceededError } from '../src/jev/client.js';
import type { DecisionEngine } from '../src/providers/jev/decision-engine.js';
import { FakeJevClient } from './fakes/fake-jev-client.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'tiny-repo');

/**
 * Wraps FakeJevClient to throw BugBudgetExceededError only on the labeled
 * call - simulates the budget running out partway through the pipeline
 * (Phase C here) rather than at the very first call.
 */
class BudgetExhaustedAtLabel implements DecisionEngine {
  constructor(
    private inner: FakeJevClient,
    private failLabel: string
  ) {}
  async ask(label: string, req: Parameters<FakeJevClient['ask']>[1]) {
    if (label === this.failLabel) {
      throw new BugBudgetExceededError(`budget exhausted at ${label}`);
    }
    return this.inner.ask(label, req);
  }
  getCallLog() {
    return this.inner.getCallLog();
  }
  getTotals() {
    return this.inner.getTotals();
  }
}

test('investigateV3 degrades gracefully when the budget runs out during Phase C, keeping the Phase B file ranking', async () => {
  const fake = new FakeJevClient({
    pickWinner: (req) => {
      const criteria = (Object.values(req.questions)[0] as any).criteria as Record<string, string | null>;
      const mathKey = Object.keys(criteria).find((k) => k.includes('math.js'));
      return mathKey ?? Object.keys(criteria)[0];
    },
  });
  const engine = new BudgetExhaustedAtLabel(fake, 'phaseC_rank_functions');

  const result = await investigateV3(
    engine,
    { bug_id: 'test-bug', bug_description: 'add() returns wrong sum', error_message: null, stack_trace: null, hinted_files: [] },
    FIXTURE_ROOT
  );

  assert.equal(result.functionRankingIncomplete, true);
  assert.deepEqual(result.functionRanking, []);
  assert.ok(result.fileRanking.length > 0, 'Phase B ranking must survive a Phase C budget failure');
  assert.equal(result.fileRanking[0].file, 'src/math.js');
});

test('investigateV3 still propagates a budget failure in Phase B (no usable ranking exists yet)', async () => {
  const fake = new FakeJevClient({ pickWinner: (req) => Object.keys((Object.values(req.questions)[0] as any).criteria)[0] });
  const engine = new BudgetExhaustedAtLabel(fake, 'phaseB_rank_files');

  await assert.rejects(
    () =>
      investigateV3(
        engine,
        { bug_id: 'test-bug-2', bug_description: 'something broke', error_message: null, stack_trace: null, hinted_files: [] },
        FIXTURE_ROOT
      ),
    BugBudgetExceededError
  );
});
