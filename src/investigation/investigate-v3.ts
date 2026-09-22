/**
 * V3 investigation pipeline: identical to V2's investigate() (investigator.ts)
 * except Phase B (file ranking) uses rankFilesChunked instead of a single
 * heuristic-prefiltered call. V2's investigator.ts, files.ts, functions.ts,
 * subsystem.ts remain unmodified and are reused here unchanged - this is a
 * new entry point, not an edit to the frozen V2 files.
 */
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { BugRecord } from './bug-record.js';
import { BugBudgetExceededError } from '../jev/client.js';
import { scanRepo, buildStructuralSummary, listCandidateFiles, type RepoScan } from '../repo/scanner.js';
import { classifySubsystem, type SubsystemResult } from './subsystem.js';
import { rankFunctions, type FunctionRanking } from './functions.js';
import { rankFilesChunked } from './files-chunked.js';
import type { FileRanking } from './files.js';

export type InvestigationResultV3 = {
  bugId: string;
  subsystem: SubsystemResult;
  fileRanking: FileRanking;
  functionRanking: FunctionRanking;
  scan: RepoScan;
  usedChunking: boolean;
  chunkCount: number;
  /**
   * True when Phase C (function-level ranking) was skipped because the
   * per-bug call/cost budget ran out after Phase B already produced a real
   * fileRanking. Phase A/B budget exhaustion is NOT caught here - without a
   * fileRanking there is nothing meaningful to return, so that still
   * propagates as a hard failure (see core/investigate.ts).
   */
  functionRankingIncomplete: boolean;
};

export async function investigateV3(engine: DecisionEngine, bug: BugRecord, repoRoot: string): Promise<InvestigationResultV3> {
  const scan = scanRepo(repoRoot);
  const structuralSummary = buildStructuralSummary(scan);

  const subsystem = await classifySubsystem(engine, bug, structuralSummary);

  const allCandidateFiles = listCandidateFiles(scan);
  const usedChunking = allCandidateFiles.length > 40;
  const chunkCount = usedChunking ? Math.ceil(allCandidateFiles.length / 40) : 1;

  const fileRanking = await rankFilesChunked(engine, bug, scan, allCandidateFiles, subsystem.choice);

  const topFiles = fileRanking.slice(0, 5).map((r) => r.file);
  let functionRanking: FunctionRanking = [];
  let functionRankingIncomplete = false;
  try {
    functionRanking = await rankFunctions(engine, bug, repoRoot, topFiles);
  } catch (err) {
    if (!(err instanceof BugBudgetExceededError)) throw err;
    functionRankingIncomplete = true;
  }

  return { bugId: bug.bug_id, subsystem, fileRanking, functionRanking, scan, usedChunking, chunkCount, functionRankingIncomplete };
}
