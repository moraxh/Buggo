/**
 * Agent-facing JSON serialization. Pure mapping from the domain Case to a
 * stable wire shape - no terminal rendering, no detective prose. This is
 * the first-class machine interface (spec section 17): stdout for
 * `--format json` is exactly JSON.stringify(toAgentResult(case)), nothing
 * else written to stdout alongside it.
 */
import type { Case, Suspect, Evidence, CaseStatus } from '../../core/types.js';

export type AgentEvidence =
  | { type: 'symbol_match'; symbols: string[] }
  | { type: 'subsystem_hint'; subsystem: string; confidence: number }
  | { type: 'model_decision'; detail: string }
  | { type: 'path_match'; detail: string };

export type AgentSuspect = {
  rank: number;
  path: string;
  confidence: number;
  symbols: string[];
  evidence: AgentEvidence[];
};

export type AgentError = {
  message: string;
  stage: string;
};

export type AgentResult = {
  schemaVersion: '1';
  caseId: string;
  status: CaseStatus;
  report: {
    description: string;
    errorMessage: string | null;
    stackTrace: string | null;
    failingTest: string | null;
    hintedFiles: string[];
  };
  repository: {
    root: string;
    productionFileCount: number;
  };
  suspects: AgentSuspect[];
  costs: { jevCalls: number; costUsd: number };
  timingsMs: { total: number };
  recommendedNextActions: string[];
  error: AgentError | null;
};

function mapEvidence(e: Evidence): AgentEvidence {
  switch (e.kind) {
    case 'symbol_match':
      return { type: 'symbol_match', symbols: e.symbols };
    case 'subsystem_hint':
      return { type: 'subsystem_hint', subsystem: e.subsystem, confidence: e.confidence };
    case 'model_decision':
      return { type: 'model_decision', detail: e.detail };
    case 'path_match':
      return { type: 'path_match', detail: e.detail };
  }
}

function mapSuspect(s: Suspect): AgentSuspect {
  return {
    rank: s.rank,
    path: s.path,
    confidence: s.confidence,
    symbols: s.symbols,
    evidence: s.evidence.map(mapEvidence),
  };
}

function recommendedNextActions(kase: Case): string[] {
  if (kase.status === 'FAILED') {
    return ['Investigation failed before producing suspects; inspect the error field and retry.'];
  }
  const suspects = kase.localization?.suspects ?? [];
  if (suspects.length === 0) {
    return ['No suspects were identified; consider providing more evidence (error message, stack trace, failing test).'];
  }
  const top = suspects[0];
  return [
    `Inspect ${top.path} first (rank 1, confidence ${top.confidence.toFixed(2)}).`,
    ...suspects.slice(1, 3).map((s) => `If that is not the cause, inspect ${s.path} (rank ${s.rank}).`),
  ];
}

export function toAgentResult(kase: Case): AgentResult {
  return {
    schemaVersion: kase.schemaVersion,
    caseId: kase.caseId,
    status: kase.status,
    report: {
      description: kase.report.description,
      errorMessage: kase.report.errorMessage ?? null,
      stackTrace: kase.report.stackTrace ?? null,
      failingTest: kase.report.failingTest ?? null,
      hintedFiles: kase.report.hintedFiles ?? [],
    },
    repository: kase.repository,
    suspects: (kase.localization?.suspects ?? []).map(mapSuspect),
    costs: kase.costs,
    timingsMs: kase.timingsMs,
    recommendedNextActions: recommendedNextActions(kase),
    error: kase.error,
  };
}

/** stdout-ready string: valid JSON only, no trailing content. */
export function toAgentJsonString(kase: Case): string {
  return JSON.stringify(toAgentResult(kase), null, 2);
}
