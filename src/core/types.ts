/**
 * Core domain model. This is what the CLI and the agent/JSON interface both
 * render from - no terminal or presentation logic here.
 */

export type CaseStatus =
  | 'OPEN'
  | 'SCANNING'
  | 'LOCALIZING'
  | 'LOCALIZED'
  | 'PARTIAL'
  | 'FAILED';
// Reserved for later versions (not reachable in v0.1):
// INVESTIGATING | REPRODUCED | VERIFIED | CLOSED

export type BugReport = {
  description: string;
  errorMessage?: string;
  stackTrace?: string;
  failingTest?: string;
};

/** What we actually know happened, as distinct from what the model decided. */
export type Evidence =
  | { kind: 'path_match'; detail: string }
  | { kind: 'symbol_match'; symbols: string[] }
  | { kind: 'subsystem_hint'; subsystem: string; confidence: number }
  | { kind: 'model_decision'; detail: string };

export type SuspectStage = 'file' | 'function';

export type Suspect = {
  rank: number;
  path: string;
  confidence: number;
  symbols: string[];
  evidence: Evidence[];
  stage: SuspectStage;
};

export type Decision = {
  label: string;
  timestamp: string;
  latencyMs: number;
  cached: boolean;
};

export type LocalizationResult = {
  suspects: Suspect[];
  usedChunking: boolean;
  chunkCount: number;
};

export type CaseCosts = {
  jevCalls: number;
  costUsd: number;
};

export type CaseError = {
  message: string;
  stage: 'scan' | 'localization' | 'unknown';
};

export type Case = {
  schemaVersion: '1';
  caseId: string;
  createdAt: string;
  status: CaseStatus;
  report: BugReport;
  repository: {
    root: string;
    productionFileCount: number;
  };
  localization: LocalizationResult | null;
  decisions: Decision[];
  costs: CaseCosts;
  timingsMs: {
    total: number;
  };
  error: CaseError | null;
};
