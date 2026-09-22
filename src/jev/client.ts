import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, requireApiKey } from '../config.js';

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  criteria: string[];
};

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevRequest = {
  state: string | object;
  questions: Record<string, JevQuestion>;
};

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = {
  type: 'score';
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
};
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
  id?: string;
  provider?: string;
};

export type CallLogEntry = {
  timestamp: string;
  bugId: string;
  label: string;
  request: JevRequest;
  response: JevResponse | null;
  error: string | null;
  latencyMs: number;
  cached: boolean;
};

class BugBudgetExceededError extends Error {}

export class JevClient {
  private callLog: CallLogEntry[] = [];
  private callCount = 0;
  private totalCost = 0;
  private bugId: string;

  constructor(bugId: string) {
    this.bugId = bugId;
    mkdirSync(config.cacheDir, { recursive: true });
  }

  getCallLog(): CallLogEntry[] {
    return this.callLog;
  }

  getTotals() {
    return { calls: this.callCount, cost: this.totalCost };
  }

  private cacheKeyFor(req: JevRequest): string {
    const canonical = JSON.stringify(req);
    const hash = createHash('sha256').update(canonical).digest('hex');
    return join(config.cacheDir, `${hash}.json`);
  }

  private readCache(req: JevRequest): JevResponse | null {
    const path = this.cacheKeyFor(req);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  private writeCache(req: JevRequest, res: JevResponse) {
    writeFileSync(this.cacheKeyFor(req), JSON.stringify(res, null, 2));
  }

  /**
   * Sends one Jev request (one or more parallel questions against one state).
   * `label` identifies the call in traces/logs (e.g. "phaseA_subsystem").
   */
  async ask(label: string, req: JevRequest): Promise<JevResponse> {
    if (this.callCount >= config.maxCallsPerBug) {
      throw new BugBudgetExceededError(
        `Bug ${this.bugId}: exceeded maxCallsPerBug (${config.maxCallsPerBug})`
      );
    }
    if (this.totalCost >= config.maxCostPerBugUsd) {
      throw new BugBudgetExceededError(
        `Bug ${this.bugId}: exceeded maxCostPerBugUsd ($${config.maxCostPerBugUsd})`
      );
    }

    const cached = this.readCache(req);
    if (cached) {
      this.callLog.push({
        timestamp: new Date().toISOString(),
        bugId: this.bugId,
        label,
        request: req,
        response: cached,
        error: null,
        latencyMs: 0,
        cached: true,
      });
      return cached;
    }

    const apiKey = requireApiKey();
    const start = Date.now();
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      try {
        const res = await fetch(config.jevEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.jevModel,
            state: req.state,
            questions: req.questions,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const latencyMs = Date.now() - start;

        if (!res.ok) {
          const body = await res.text();
          lastError = `HTTP ${res.status}: ${body}`;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            // Non-retryable client error
            this.callCount++;
            this.callLog.push({
              timestamp: new Date().toISOString(),
              bugId: this.bugId,
              label,
              request: req,
              response: null,
              error: lastError,
              latencyMs,
              cached: false,
            });
            throw new Error(lastError);
          }
          throw new Error(lastError); // retryable (429/5xx)
        }

        const json = (await res.json()) as JevResponse;
        this.callCount++;
        this.totalCost += json.usage?.cost ?? 0;
        this.callLog.push({
          timestamp: new Date().toISOString(),
          bugId: this.bugId,
          label,
          request: req,
          response: json,
          error: null,
          latencyMs,
          cached: false,
        });
        this.writeCache(req, json);
        return json;
      } catch (err) {
        clearTimeout(timeout);
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < config.maxRetries) {
          const delay = config.retryBaseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
    }

    this.callLog.push({
      timestamp: new Date().toISOString(),
      bugId: this.bugId,
      label,
      request: req,
      response: null,
      error: lastError,
      latencyMs: Date.now() - start,
      cached: false,
    });
    throw new Error(`Jev call failed after retries: ${lastError}`);
  }
}
