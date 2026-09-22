/**
 * Public programmatic entry point. This is the canonical API: the CLI calls
 * it, tests call it, and the MCP server calls it. Nothing else should
 * import from core/investigate.ts directly.
 */
export { investigate } from './core/investigate.js';
export type { InvestigateInput } from './core/investigate.js';
export type {
  Case,
  CaseStatus,
  BugReport,
  Suspect,
  SuspectStage,
  Evidence,
  Decision,
  LocalizationResult,
  CaseCosts,
  CaseError,
} from './core/types.js';

export { toAgentResult, toAgentJsonString } from './interfaces/json/format.js';
export type { AgentResult, AgentSuspect, AgentEvidence, AgentError } from './interfaces/json/format.js';

export { loadCase, listCases } from './storage/case-store.js';
export type { CaseSummary } from './storage/case-store.js';

export { createBuggoMcpServer, runBuggoMcpServer } from './interfaces/mcp/server.js';
