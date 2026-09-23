/**
 * `buggo hunt` entry point: blind correctness-risk triage over a repository,
 * with no bug report. Ranks files by how likely they are to hide an
 * undiscovered bug, using structural signal (directory naming, git-derived
 * fix-commit history) - never a substitute for actually reproducing
 * anything. Returns a prioritized list of files worth investigating, not a
 * diagnosis.
 *
 * Mirrors core/investigate.ts's shape (case id allocation, never throwing,
 * cost/call accounting) but is a genuinely different pipeline - hunt has no
 * BugRecord, no file-ranking against a description, and stops at file-level
 * triage (see hunt/triage.ts's header for why).
 */
import { JevDecisionEngine } from '../providers/jev/decision-engine.js';
import { scanRepoForHunt } from '../hunt/scanner-hierarchy.js';
import { triageModules, triageFiles } from '../hunt/triage.js';
import { getFileRiskSignal, describeRiskSignal } from '../hunt/risk-signal.js';
import { nextCaseId } from './case-id.js';
import type { HuntResult, HuntSuspect } from '../hunt/types.js';

export type HuntInput = {
  repoRoot: string;
  /** Cap on how many files enter Stage 2 (file-level) triage, drawn from
   * the top modules Stage 1 flags - keeps Stage 2's own chunking bounded on
   * very large repos instead of re-triaging every file in every module. */
  maxFilesForStage2?: number;
  /** Optional short description of what the package/repo does, passed to
   * Stage 1 as context (e.g. from package.json's "description" field) -
   * never bug-specific, purely structural context. */
  packageDescription?: string | null;
};

const DEFAULT_MAX_FILES_FOR_STAGE2 = 200;

export async function hunt(input: HuntInput): Promise<HuntResult> {
  const createdAt = new Date().toISOString();
  const start = Date.now();
  const disclaimer =
    'This is a blind structural risk estimate, not a discovered bug. Nothing listed here has been reproduced - ' +
    'treat these as starting points for investigation, the same way you would treat a code-review "worth a second ' +
    'look" flag.';

  let huntId: string;
  try {
    huntId = nextCaseId().replace('BG-', 'BH-');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      schemaVersion: '1',
      huntId: `BH-ERR-${Date.now()}`,
      createdAt,
      status: 'FAILED',
      repository: { root: input.repoRoot, productionFileCount: 0 },
      suspects: [],
      costs: { jevCalls: 0, costUsd: 0 },
      timingsMs: { total: Date.now() - start },
      error: { message: `Could not allocate a hunt id: ${message}` },
      disclaimer,
    };
  }

  const engine = new JevDecisionEngine(huntId);

  try {
    const { scan, groups, totalFiles } = scanRepoForHunt(input.repoRoot);
    const packageDescription = input.packageDescription ?? scan.packageJson?.description ?? null;

    let candidateFiles: string[];
    if (totalFiles <= (input.maxFilesForStage2 ?? DEFAULT_MAX_FILES_FOR_STAGE2)) {
      // Small enough repo: skip Stage 1 module triage entirely and go
      // straight to file-level triage over every candidate - Stage 1 exists
      // to narrow down large repos, not to add a call where it isn't needed.
      candidateFiles = groups.flatMap((g) => g.files);
    } else {
      const moduleRanking = await triageModules(engine, groups, packageDescription);
      const topModuleDirs = new Set(
        moduleRanking
          .sort((a, b) => b.probability - a.probability)
          .slice(0, Math.max(1, Math.ceil(groups.length * 0.3)))
          .map((r) => r.moduleDir)
      );
      candidateFiles = groups.filter((g) => topModuleDirs.has(g.moduleDir)).flatMap((g) => g.files);
      // Cap so Stage 2 never re-triages more than maxFilesForStage2 files
      // even if the top 30% of modules is still large - keeps this bounded
      // on a repo with a few huge modules rather than many small ones.
      candidateFiles = candidateFiles.slice(0, input.maxFilesForStage2 ?? DEFAULT_MAX_FILES_FOR_STAGE2);
    }

    const fileRanking = await triageFiles(engine, scan, candidateFiles, input.repoRoot);
    const risk = getFileRiskSignal(input.repoRoot);

    const TOP_K_SUSPECTS = 10; // hunt has no bug-specific signal to cut off earlier than investigate's top-5, so a wider list
    const suspects: HuntSuspect[] = fileRanking
      .sort((a, b) => b.probability - a.probability)
      .slice(0, TOP_K_SUSPECTS)
      .map((r, i) => ({
        rank: i + 1,
        path: r.path,
        probability: r.probability,
        riskSignal: describeRiskSignal(risk.get(r.path)),
      }));

    const totals = engine.getTotals();
    return {
      schemaVersion: '1',
      huntId,
      createdAt,
      status: 'TRIAGED',
      repository: { root: input.repoRoot, productionFileCount: totalFiles },
      suspects,
      costs: { jevCalls: totals.calls, costUsd: totals.cost },
      timingsMs: { total: Date.now() - start },
      error: null,
      disclaimer,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const totals = engine.getTotals();
    return {
      schemaVersion: '1',
      huntId,
      createdAt,
      status: 'FAILED',
      repository: { root: input.repoRoot, productionFileCount: 0 },
      suspects: [],
      costs: { jevCalls: totals.calls, costUsd: totals.cost },
      timingsMs: { total: Date.now() - start },
      error: { message },
      disclaimer,
    };
  }
}
