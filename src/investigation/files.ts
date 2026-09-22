import type { ChoiceAnswer } from '../jev/client.js';
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { BugRecord } from './bug-record.js';
import type { RepoScan } from '../repo/scanner.js';
import { config } from '../config.js';

export type FileRanking = { file: string; probability: number }[];

/**
 * Real API adaptation note: the spec wants a literal weighted ranked list
 * (file -> score summing to ~1). Jev's `choice` primitive returns exactly
 * that: a probability distribution over a fixed set of named options, with
 * an overall confidence. We map "candidate files" -> "choice options" and
 * treat the returned `probabilities` map directly as the ranking. This is
 * the closest faithful mapping to a real, documented Jev primitive (see
 * docs.typesafe.ai/primitives/choice) rather than inventing an unsupported
 * "rank multiple items with per-item scores" endpoint.
 *
 * Constraint: `choice` supports at most 255 options and the whole request
 * must fit Jev's ~32k token state+question budget, so we cap the candidate
 * list to config.maxCandidateFiles and provide symbol-derived one-line
 * descriptions instead of full file contents.
 */
export async function rankFiles(
  engine: DecisionEngine,
  bug: BugRecord,
  scan: RepoScan,
  candidateFiles: string[],
  subsystemHint: string
): Promise<FileRanking> {
  const limited = candidateFiles.slice(0, config.maxCandidateFiles);

  const criteria: Record<string, string | null> = {};
  for (const relPath of limited) {
    const sym = scan.fileSymbols.get(relPath);
    if (sym && (sym.functions.length || sym.exports.length)) {
      // Was capped at 8 (arbitrary, order-of-appearance-in-file), which silently
      // dropped the actually-relevant function name in files with many methods
      // (e.g. a 224-method class where the real fix was method #150). Use the
      // same per-file cap as phase C's function ranking for consistency.
      const fnNames = sym.functions.slice(0, config.maxFunctionsPerFile).map((f) => f.name).join(', ');
      const exportNames = sym.exports.slice(0, config.maxFunctionsPerFile).join(', ');
      criteria[relPath] = `exports: ${exportNames || 'none'}; functions: ${fnNames || 'none'}`;
    } else {
      criteria[relPath] = null;
    }
  }

  const state = {
    bug_description: bug.bug_description,
    error_message: bug.error_message,
    stack_trace: bug.stack_trace,
    likely_subsystem: subsystemHint,
  };

  const res = await engine.ask('phaseB_rank_files', {
    state,
    questions: {
      most_likely_file: {
        type: 'choice',
        instructions:
          'Which file most likely contains the root cause of this bug? Consider file names, exported symbols, and function names relative to the bug description and error.',
        criteria,
      },
    },
  });

  const answer = res.answers.most_likely_file as ChoiceAnswer;
  const ranking = Object.entries(answer.probabilities)
    .map(([file, probability]) => ({ file, probability }))
    .sort((a, b) => b.probability - a.probability);

  return ranking;
}
