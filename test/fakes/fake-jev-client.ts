/**
 * Deterministic fake standing in for JevClient in unit tests - no network,
 * no cost, no real API key required. Duck-types the subset of JevClient's
 * surface the investigation pipeline actually calls (ask/getCallLog/
 * getTotals), so it can be passed anywhere a JevClient is expected without
 * subclassing the real (network-backed) implementation.
 */
import type { JevRequest, JevResponse, CallLogEntry, ChoiceQuestion } from '../../src/jev/client.js';

export type FakeAnswerPlan = {
  /** Called with the request; return the option key that should "win". */
  pickWinner: (req: JevRequest) => string;
};

export class FakeJevClient {
  private callLog: CallLogEntry[] = [];
  private callCount = 0;
  private plan: FakeAnswerPlan;

  constructor(plan: FakeAnswerPlan) {
    this.plan = plan;
  }

  async ask(label: string, req: JevRequest): Promise<JevResponse> {
    this.callCount++;
    const questionEntries = Object.entries(req.questions);
    const answers: JevResponse['answers'] = {};

    for (const [key, question] of questionEntries) {
      if (question.type !== 'choice') {
        throw new Error('FakeJevClient only supports choice questions (sufficient for the current pipeline)');
      }
      const options = Object.keys((question as ChoiceQuestion).criteria);
      const winner = this.plan.pickWinner(req);
      const resolvedWinner = options.includes(winner) ? winner : options[0];

      const probabilities: Record<string, number> = {};
      const remaining = options.length > 1 ? 0.1 / (options.length - 1) : 0;
      for (const opt of options) {
        probabilities[opt] = opt === resolvedWinner ? 0.9 : remaining;
      }

      answers[key] = {
        type: 'choice',
        choice: resolvedWinner,
        confidence: 0.9,
        probabilities,
      };
    }

    const response: JevResponse = {
      model: 'fake/jev-test',
      answers,
      usage: { input_tokens: 10, output_tokens: 5, cost: 0.0001 },
    };

    this.callLog.push({
      timestamp: new Date().toISOString(),
      bugId: 'fake-bug',
      label,
      request: req,
      response,
      error: null,
      latencyMs: 1,
      cached: false,
    });

    return response;
  }

  getCallLog(): CallLogEntry[] {
    return this.callLog;
  }

  getTotals() {
    return { calls: this.callCount, cost: this.callCount * 0.0001 };
  }
}
