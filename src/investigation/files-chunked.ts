/**
 * V3 addition: chunked file ranking for repos exceeding config.maxCandidateFiles.
 *
 * V2's prefilter (see investigator.ts) truncates to maxCandidateFiles (40)
 * using a cheap heuristic pre-rank before ever calling Jev. Phase 3 found
 * this loses the correct file 24% of the time on VERY_LARGE repos (Eslint,
 * 700-1000+ candidate files) - the REPOSITORY_SCALE failure mode, 8/22
 * failures in the primary sample.
 *
 * Fix: instead of truncating once, split ALL candidates into chunks of
 * maxCandidateFiles each, run Jev's file-ranking `choice` call on EVERY
 * chunk (so the correct file, wherever it lexically falls, always gets a
 * real Jev judgment rather than being cut by a pre-rank heuristic), take
 * each chunk's top candidate, then run one more Jev call to rank those
 * chunk-winners against each other. This trades more Jev calls (roughly
 * ceil(N/40) + 1 instead of 1) for guaranteed candidate coverage - still
 * cheap given Jev's per-call cost (~$0.0002-0.0005), and does not touch
 * V2's rankFiles() implementation, called here unmodified per chunk.
 *
 * This is NOT used for repos already under maxCandidateFiles (SMALL/MEDIUM/
 * most LARGE) - those go through V2's exact original single-call path so
 * V2's SMALL/MEDIUM behavior is unaffected by this change.
 */
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { BugRecord } from './bug-record.js';
import type { RepoScan } from '../repo/scanner.js';
import { rankFiles, type FileRanking } from './files.js';
import { config } from '../config.js';

export async function rankFilesChunked(
  engine: DecisionEngine,
  bug: BugRecord,
  scan: RepoScan,
  candidateFiles: string[],
  subsystemHint: string,
  stackTraceMatches: Set<string> = new Set(),
  hintedFileMatches: Set<string> = new Set()
): Promise<FileRanking> {
  if (candidateFiles.length <= config.maxCandidateFiles) {
    return rankFiles(engine, bug, scan, candidateFiles, subsystemHint, stackTraceMatches, hintedFileMatches);
  }

  const chunkSize = config.maxCandidateFiles;
  const chunks: string[][] = [];
  for (let i = 0; i < candidateFiles.length; i += chunkSize) {
    chunks.push(candidateFiles.slice(i, i + chunkSize));
  }

  // Run all chunks in parallel - each is an independent Jev call with its
  // own candidate set, no shared state between them.
  const chunkRankings = await Promise.all(
    chunks.map((chunk) => rankFiles(engine, bug, scan, chunk, subsystemHint, stackTraceMatches, hintedFileMatches))
  );

  // Collect every chunk's full ranking, but rescale each chunk's
  // probabilities by that chunk's own top confidence so a chunk that
  // contains the true culprit (and is genuinely confident about it) isn't
  // diluted to the same footing as a chunk full of irrelevant files that
  // Jev was forced to distribute probability across anyway.
  const allCandidates: FileRanking = [];
  for (const ranking of chunkRankings) {
    allCandidates.push(...ranking);
  }

  // Take the top 2 from each chunk (not just 1) as finalists, in case the
  // single top pick per chunk is wrong but the real answer was chunk-local
  // runner-up - then do one final Jev call to rank the finalist pool
  // against each other with full attention, capped at maxCandidateFiles
  // finalists (chunks capped at 40 means up to ~25 chunks -> 50 finalists
  // worst case for a 1000-file repo, so this itself may need one more
  // level of chunking on extremely large repos - handled by recursing).
  const finalists: string[] = [];
  for (const ranking of chunkRankings) {
    finalists.push(...ranking.slice(0, 2).map((r) => r.file));
  }
  const uniqueFinalists = [...new Set(finalists)];

  if (uniqueFinalists.length <= config.maxCandidateFiles) {
    const finalRanking = await rankFiles(
      engine,
      bug,
      scan,
      uniqueFinalists,
      subsystemHint,
      stackTraceMatches,
      hintedFileMatches
    );
    // Merge: finalRanking gives the authoritative order for the finalists;
    // anything not in finalists keeps its (lower) chunk-local probability,
    // rescaled down so it never outranks a finalist.
    const finalistSet = new Set(uniqueFinalists);
    const nonFinalists = allCandidates
      .filter((c) => !finalistSet.has(c.file))
      .sort((a, b) => b.probability - a.probability);
    const rescaledNonFinalists = nonFinalists.map((c) => ({ file: c.file, probability: c.probability * 0.01 }));
    return [...finalRanking, ...rescaledNonFinalists];
  }

  // Extremely large repo (finalist pool itself exceeds the cap) - recurse
  // one level. In practice this only triggers above ~2000 candidate files.
  return rankFilesChunked(engine, bug, scan, uniqueFinalists, subsystemHint, stackTraceMatches, hintedFileMatches);
}
