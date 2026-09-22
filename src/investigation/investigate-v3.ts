/**
 * V3 investigation pipeline: identical to V2's investigate() (investigator.ts)
 * except Phase B (file ranking) uses rankFilesChunked instead of a single
 * heuristic-prefiltered call. V2's investigator.ts, files.ts, functions.ts,
 * subsystem.ts remain unmodified and are reused here unchanged - this is a
 * new entry point, not an edit to the frozen V2 files.
 */
import { JevClient } from '../jev/client.js';
import type { BugRecord } from './bug-record.js';
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
};

export async function investigateV3(client: JevClient, bug: BugRecord, repoRoot: string): Promise<InvestigationResultV3> {
  const scan = scanRepo(repoRoot);
  const structuralSummary = buildStructuralSummary(scan);

  const subsystem = await classifySubsystem(client, bug, structuralSummary);

  const allCandidateFiles = listCandidateFiles(scan);
  const usedChunking = allCandidateFiles.length > 40;
  const chunkCount = usedChunking ? Math.ceil(allCandidateFiles.length / 40) : 1;

  const fileRanking = await rankFilesChunked(client, bug, scan, allCandidateFiles, subsystem.choice);

  const topFiles = fileRanking.slice(0, 5).map((r) => r.file);
  const functionRanking = await rankFunctions(client, bug, repoRoot, topFiles);

  return { bugId: bug.bug_id, subsystem, fileRanking, functionRanking, scan, usedChunking, chunkCount };
}
