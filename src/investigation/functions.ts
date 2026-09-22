import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChoiceAnswer } from '../jev/client.js';
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { BugRecord } from './bug-record.js';
import { extractSymbols } from '../repo/ast.js';
import { config } from '../config.js';

export type FunctionRanking = { file: string; func: string; probability: number }[];

export async function rankFunctions(
  engine: DecisionEngine,
  bug: BugRecord,
  repoRoot: string,
  topFiles: string[]
): Promise<FunctionRanking> {
  const criteria: Record<string, string | null> = {};
  const keyToFileFunc = new Map<string, { file: string; func: string }>();

  for (const relPath of topFiles) {
    const full = join(repoRoot, relPath);
    if (!existsSync(full)) continue;
    let content: string;
    try {
      content = readFileSync(full, 'utf-8');
    } catch {
      continue;
    }
    const symbols = extractSymbols(content, relPath);
    if (!symbols) continue;

    for (const fn of symbols.functions.slice(0, config.maxFunctionsPerFile)) {
      const key = `${relPath}::${fn.name}`;
      criteria[key] = `function/method '${fn.name}' defined in ${relPath} around line ${fn.line}`;
      keyToFileFunc.set(key, { file: relPath, func: fn.name });
    }
  }

  if (Object.keys(criteria).length === 0) {
    return [];
  }

  const state = {
    bug_description: bug.bug_description,
    error_message: bug.error_message,
    stack_trace: bug.stack_trace,
  };

  const res = await engine.ask('phaseC_rank_functions', {
    state,
    questions: {
      most_likely_function: {
        type: 'choice',
        instructions:
          'Given the bug report, which function or method most likely contains the root cause?',
        criteria,
      },
    },
  });

  const answer = res.answers.most_likely_function as ChoiceAnswer;
  const ranking = Object.entries(answer.probabilities)
    .map(([key, probability]) => {
      const mapped = keyToFileFunc.get(key)!;
      return { file: mapped.file, func: mapped.func, probability };
    })
    .sort((a, b) => b.probability - a.probability);

  return ranking;
}
