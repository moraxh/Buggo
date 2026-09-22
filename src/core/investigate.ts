import { investigateV3, type InvestigationResultV3 } from '../investigation/investigate-v3.js';
import { JevDecisionEngine, type EngineProgressListener } from '../providers/jev/decision-engine.js';
import { nextCaseId } from './case-id.js';
import { saveCase } from '../storage/case-store.js';
import type { Case, Evidence, Suspect, BugReport } from './types.js';

export type InvestigateInput = {
  repoRoot: string;
  report: BugReport;
  /** Optional: observe phase-by-phase progress as the investigation runs (see EngineProgressListener). */
  onProgress?: EngineProgressListener;
};

export async function investigate(input: InvestigateInput): Promise<Case> {
  const createdAt = new Date().toISOString();
  const start = Date.now();

  let caseId: string;
  try {
    caseId = nextCaseId();
  } catch (err) {
    // Id allocation itself failed (e.g. .buggo/cases cannot be created:
    // disk full, permissions, blocked by a same-named file). No Jev call
    // has happened yet, so there's nothing to preserve except reporting the
    // failure - but investigate() must still return a Case, never throw,
    // the same guarantee every other failure path in this function keeps.
    const message = err instanceof Error ? err.message : String(err);
    const fallbackId = `BG-ERR-${Date.now()}`;
    return {
      schemaVersion: '1',
      caseId: fallbackId,
      createdAt,
      status: 'FAILED',
      report: input.report,
      repository: { root: input.repoRoot, productionFileCount: 0 },
      localization: null,
      decisions: [],
      costs: { jevCalls: 0, costUsd: 0 },
      timingsMs: { total: Date.now() - start },
      error: { message: `Could not allocate a case id: ${message}`, stage: 'unknown' },
    };
  }

  const engine = new JevDecisionEngine(caseId, input.onProgress);
  let kase: Case;

  try {
    const result = await investigateV3(
      engine,
      {
        bug_id: caseId,
        bug_description: input.report.description,
        error_message: input.report.errorMessage ?? null,
        stack_trace: input.report.stackTrace ?? null,
      },
      input.repoRoot
    );

    const totals = engine.getTotals();

    kase = {
      schemaVersion: '1',
      caseId,
      createdAt,
      status: result.functionRankingIncomplete ? 'PARTIAL' : 'LOCALIZED',
      report: input.report,
      repository: {
        root: input.repoRoot,
        productionFileCount: result.scan.allFiles.filter((f) => !f.isTest).length,
      },
      localization: {
        suspects: toSuspects(result),
        usedChunking: result.usedChunking,
        chunkCount: result.chunkCount,
      },
      decisions: engine.getCallLog().map((c) => ({
        label: c.label,
        timestamp: c.timestamp,
        latencyMs: c.latencyMs,
        cached: c.cached,
      })),
      costs: { jevCalls: totals.calls, costUsd: totals.cost },
      timingsMs: { total: Date.now() - start },
      error: result.functionRankingIncomplete
        ? {
            message:
              'Function-level ranking (Phase C) was skipped: the per-bug call/cost budget ran out. ' +
              'File-level suspects below are still real Jev judgments, just without function-level refinement.',
            stage: 'localization',
          }
        : null,
    };
  } catch (err) {
    const totals = engine.getTotals();
    const message = err instanceof Error ? err.message : String(err);
    kase = {
      schemaVersion: '1',
      caseId,
      createdAt,
      status: 'FAILED',
      report: input.report,
      repository: { root: input.repoRoot, productionFileCount: 0 },
      localization: null,
      decisions: engine.getCallLog().map((c) => ({
        label: c.label,
        timestamp: c.timestamp,
        latencyMs: c.latencyMs,
        cached: c.cached,
      })),
      costs: { jevCalls: totals.calls, costUsd: totals.cost },
      timingsMs: { total: Date.now() - start },
      error: { message, stage: classifyFailureStage(message) },
    };
  }

  try {
    saveCase(kase);
  } catch (err) {
    // The investigation itself already succeeded (and, if it called Jev,
    // already spent real money) - a persistence failure (disk full,
    // read-only mount, permissions) must not discard that result. Surface
    // it as a case-level warning instead of losing the caller's Case.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: failed to persist case ${caseId} to .buggo/cases: ${message}`);
  }
  return kase;
}

/**
 * Best-effort classification of what stage failed, from the error message
 * only - investigateV3 doesn't currently propagate a typed failure stage,
 * and scanRepo itself never throws (it swallows per-file read errors), so
 * an empty-candidate-set failure surfaces here as a Jev "no choices" error
 * rather than as a distinct scan-stage exception. Never claim more
 * precision than this actually has: default to 'unknown' rather than
 * guessing wrong.
 */
function classifyFailureStage(message: string): 'scan' | 'localization' | 'unknown' {
  if (/Choice question must have at least one choice/i.test(message)) return 'scan';
  if (/Jev call failed|maxCallsPerBug|maxCostPerBugUsd/i.test(message)) return 'localization';
  return 'unknown';
}

/**
 * Maps the top-5 file ranking into Suspects with real evidence: path
 * (implicit in the ranking), matched symbols (from AST extraction, if
 * present), and subsystem hint (a model decision, not observed evidence -
 * labeled accordingly). Never fabricates causal explanations Jev didn't
 * actually provide.
 */
function toSuspects(result: InvestigationResultV3): Suspect[] {
  const top = result.fileRanking.slice(0, 5);
  return top.map((r, i) => {
    const sym = result.scan.fileSymbols.get(r.file);
    const symbolNames = sym ? [...sym.functions.map((f) => f.name), ...sym.exports].slice(0, 10) : [];

    const evidence: Evidence[] = [];
    if (symbolNames.length) {
      evidence.push({ kind: 'symbol_match', symbols: symbolNames });
    }
    evidence.push({
      kind: 'subsystem_hint',
      subsystem: result.subsystem.choice,
      confidence: result.subsystem.confidence,
    });
    evidence.push({
      kind: 'model_decision',
      detail: `Jev file-ranking choice, probability ${r.probability.toFixed(3)}`,
    });

    return {
      rank: i + 1,
      path: r.file,
      confidence: r.probability,
      symbols: symbolNames,
      evidence,
      stage: 'file',
    };
  });
}
