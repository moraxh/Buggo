/**
 * `buggo hunt` V0: blind Jev triage - NO bug description exists at this
 * stage. Every decision uses only structural/deterministic signals:
 * directory names, symbol names, and the git-derived risk signal
 * (risk-signal.ts - see that file for the validation this is based on and
 * its known limitation) - never any bug-specific information, since none
 * exists yet.
 *
 * Two-stage hierarchy, mirroring investigate's file-chunking shape but with
 * a fundamentally different question, since there is no bug report to
 * match candidates against:
 *   Stage 1 (module-level): "Which of these modules carries the highest
 *     correctness risk for containing an undiscovered bug?" - judged per
 *     chunk of module groups, every group gets a real Jev judgment.
 *   Stage 2 (file-level, within top modules): "Which of these files is
 *     most likely to hide an edge-case behavioral bug?" - same chunking
 *     discipline within the selected top modules' files.
 *
 * This produces Top-K suspicious FILES, each with Jev's own probability as
 * the initial priority signal. `buggo hunt` V0 does not go to the function
 * level automatically - investigate's function-localization result (~41%
 * Top-1, see the research repo's Phase 3B report) is weak enough that this
 * stays at file-level triage, consistent with that finding.
 */
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { RepoScan } from '../repo/scanner.js';
import type { ModuleGroup } from './scanner-hierarchy.js';
import { config } from '../config.js';
import { getFileRiskSignal, describeRiskSignal } from './risk-signal.js';

export type TriageCandidate = { path: string; probability: number; stage: 'module' | 'file' };

async function chunkedChoice(
  engine: DecisionEngine,
  label: string,
  state: Record<string, unknown>,
  instructions: string,
  optionCriteria: Record<string, string | null>
): Promise<{ key: string; probability: number }[]> {
  const optionKeys = Object.keys(optionCriteria);
  const chunkSize = config.maxCandidateFiles;
  const chunks: string[][] = [];
  for (let i = 0; i < optionKeys.length; i += chunkSize) chunks.push(optionKeys.slice(i, i + chunkSize));

  const chunkResults = await Promise.all(
    chunks.map(async (chunk, idx) => {
      const criteria: Record<string, string | null> = {};
      for (const key of chunk) criteria[key] = optionCriteria[key];
      const res = await engine.ask(`hunt_${label}_chunk${idx}`, {
        state,
        questions: { candidate: { type: 'choice', instructions, criteria } },
      });
      const answer = res.answers.candidate as { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
      return Object.entries(answer.probabilities).map(([key, probability]) => ({ key, probability }));
    })
  );

  const all = chunkResults.flat();
  if (chunks.length === 1) return all.sort((a, b) => b.probability - a.probability);

  // Finalist round: top-2 per chunk, one more chunked-choice call, same
  // shape as investigate's files-chunked.ts finalist mechanism.
  const finalists = new Set<string>();
  for (const chunkResult of chunkResults) {
    chunkResult
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 2)
      .forEach((r) => finalists.add(r.key));
  }
  const finalistList = [...finalists];
  const finalCriteria: Record<string, string | null> = {};
  for (const key of finalistList) finalCriteria[key] = optionCriteria[key];
  const finalRes = await engine.ask(`hunt_${label}_finalists`, {
    state,
    questions: { candidate: { type: 'choice', instructions, criteria: finalCriteria } },
  });
  const finalAnswer = finalRes.answers.candidate as { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
  const finalRanking = Object.entries(finalAnswer.probabilities).map(([key, probability]) => ({ key, probability }));
  const finalistSet = new Set(finalistList);
  const nonFinalists = all.filter((r) => !finalistSet.has(r.key)).sort((a, b) => b.probability - a.probability);
  return [...finalRanking, ...nonFinalists.map((r) => ({ key: r.key, probability: r.probability * 0.01 }))];
}

export async function triageModules(
  engine: DecisionEngine,
  groups: ModuleGroup[],
  packageDescription: string | null
): Promise<{ moduleDir: string; probability: number }[]> {
  const state: Record<string, unknown> = {
    task: 'blind_correctness_risk_triage',
    package_description: packageDescription,
    note: 'No bug report is available. Judge purely on which module most plausibly hides an undiscovered behavioral defect, using directory naming.',
  };
  const optionCriteria: Record<string, string | null> = {};
  for (const g of groups) optionCriteria[g.moduleDir] = null;
  const ranking = await chunkedChoice(
    engine,
    'modules',
    state,
    'No bug report exists yet. Which of these modules/directories is most worth investigating for a hidden correctness bug (an edge case or incorrect behavior, not a style issue)? Consider directory naming.',
    optionCriteria
  );
  return ranking.map((r) => ({ moduleDir: r.key, probability: r.probability }));
}

/**
 * File-level triage within a set of candidates, weighted by the git-derived
 * risk signal (see risk-signal.ts) instead of a pure blind guess from file
 * naming alone - this is the validated improvement over naming-only triage.
 */
export async function triageFiles(
  engine: DecisionEngine,
  scan: RepoScan,
  candidateFiles: string[],
  repoRoot: string
): Promise<TriageCandidate[]> {
  const risk = getFileRiskSignal(repoRoot);
  const optionCriteria: Record<string, string | null> = {};
  for (const f of candidateFiles) {
    optionCriteria[f] = describeRiskSignal(risk.get(f));
  }

  const state: Record<string, unknown> = {
    task: 'blind_correctness_risk_triage',
    note:
      'No bug report exists. Judge which file most plausibly contains an undiscovered edge-case behavioral bug. ' +
      'Each file may show how often it has needed bug fixes historically - real observed evidence of correctness ' +
      'risk, not a guess.',
  };
  const ranking = await chunkedChoice(
    engine,
    'files',
    state,
    'No bug report exists yet. Which of these files is most likely to hide an edge-case or incorrect-behavior bug? ' +
      'Consider file naming, and especially the historical fix-commit signal when shown - a file that has repeatedly ' +
      'needed bug fixes is real evidence of latent correctness risk, weigh it heavily over naming alone. Note: this ' +
      'signal favors frequently-touched central files and can under-rank a bug hiding in a rarely-touched peripheral ' +
      'file - naming and structure still matter too.',
    optionCriteria
  );
  return ranking.map((r) => ({ path: r.key, probability: r.probability, stage: 'file' as const }));
}
