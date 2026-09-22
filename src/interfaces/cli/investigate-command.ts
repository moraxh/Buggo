/**
 * `buggo investigate` entry point. Calls the canonical investigate() API and
 * either prints agent-ready JSON (nothing else on stdout) or the detective
 * CLI rendering for humans.
 */
import { investigate } from '../../core/investigate.js';
import { toAgentJsonString } from '../json/format.js';
import { parseInvestigateArgs, ArgsError } from './args.js';
import { runInvestigateLive } from './detective-live.js';
import { getDiffFiles, getRecentlyChangedFiles } from '../../repo/git-signal.js';

/**
 * --diff and --recent-changes both resolve to a list of hinted files -
 * done here (not in args.ts) because resolving them needs repoRoot, which
 * argument parsing alone doesn't have yet. Best-effort: an invalid --diff
 * ref or a non-git repo just yields no hints rather than failing the
 * whole investigation over what is extra context, not required input.
 */
function resolveHintedFiles(repoRoot: string, diffRef: string | undefined, recentChangesCount: number | undefined): string[] {
  const hints: string[] = [];
  if (diffRef !== undefined) hints.push(...getDiffFiles(repoRoot, diffRef));
  if (recentChangesCount !== undefined) hints.push(...getRecentlyChangedFiles(repoRoot, recentChangesCount));
  return [...new Set(hints)];
}

export async function runInvestigateCommand(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseInvestigateArgs(argv);
  } catch (err) {
    if (err instanceof ArgsError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const investigateInput = {
    repoRoot: args.repoRoot,
    report: {
      description: args.description,
      errorMessage: args.errorMessage,
      stackTrace: args.stackTrace,
      failingTest: args.failingTest,
      hintedFiles: resolveHintedFiles(args.repoRoot, args.diffRef, args.recentChangesCount),
    },
    excludedFiles: args.excludedFiles,
  };

  if (args.format === 'json') {
    // No Ink here - stdout must be exactly the JSON result, nothing else.
    const kase = await investigate(investigateInput);
    process.stdout.write(toAgentJsonString(kase) + '\n');
    return kase.status === 'FAILED' ? 1 : 0;
  }

  const kase = await runInvestigateLive(investigateInput);
  return kase.status === 'FAILED' ? 1 : 0;
}
