/**
 * `buggo investigate` entry point. Calls the canonical investigate() API and
 * either prints agent-ready JSON (nothing else on stdout) or the detective
 * CLI rendering for humans.
 */
import { investigate } from '../../core/investigate.js';
import { toAgentJsonString } from '../json/format.js';
import { parseInvestigateArgs, ArgsError } from './args.js';
import { renderCaseResult } from './detective-render.js';

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

  const kase = await investigate({
    repoRoot: args.repoRoot,
    report: {
      description: args.description,
      errorMessage: args.errorMessage,
      stackTrace: args.stackTrace,
      failingTest: args.failingTest,
    },
  });

  if (args.format === 'json') {
    process.stdout.write(toAgentJsonString(kase) + '\n');
    return kase.status === 'FAILED' ? 1 : 0;
  }

  console.log('\n' + renderCaseResult(kase) + '\n');
  return kase.status === 'FAILED' ? 1 : 0;
}
