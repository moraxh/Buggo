/**
 * `buggo cases` and `buggo show <caseId>` - lightweight inspection of
 * locally persisted cases. Not a case-management app: list and show only.
 */
import { listCases, loadCase } from '../../storage/case-store.js';
import { toAgentJsonString } from '../json/format.js';
import { renderCaseResult } from './detective-render.js';
import { parseFormatFlag, extractPositionals, SHOW_VALUE_FLAGS, ArgsError } from './args.js';

const DEFAULT_CASES_SHOWN = 50;

export function runCasesCommand(): number {
  const cases = listCases({ limit: DEFAULT_CASES_SHOWN });
  if (cases.length === 0) {
    console.log('No cases yet. Run: buggo investigate "<description>"');
    return 0;
  }
  for (const c of cases) {
    const suspect = c.topSuspect ? ` -> ${c.topSuspect}` : '';
    console.log(`${c.caseId}  ${c.status.padEnd(10)} ${c.description.slice(0, 60)}${suspect}`);
  }
  if (cases.length === DEFAULT_CASES_SHOWN) {
    console.log(`\n(showing the ${DEFAULT_CASES_SHOWN} most recent cases; see .buggo/cases/ for the full history)`);
  }
  return 0;
}

export function runShowCommand(argv: string[]): number {
  const positionals = extractPositionals(argv, SHOW_VALUE_FLAGS);
  const caseId = positionals[0];

  if (!caseId) {
    console.error('Usage: buggo show <caseId> [--format human|json]');
    return 2;
  }
  if (positionals.length > 1) {
    console.error(`Unexpected extra argument(s): ${positionals.slice(1).join(', ')}`);
    return 2;
  }

  let format: 'human' | 'json';
  try {
    format = parseFormatFlag(argv);
  } catch (err) {
    if (err instanceof ArgsError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const kase = loadCase(caseId);
  if (!kase) {
    console.error(`No such case: ${caseId}`);
    return 1;
  }

  if (format === 'json') {
    process.stdout.write(toAgentJsonString(kase) + '\n');
    return 0;
  }

  console.log('\n' + renderCaseResult(kase) + '\n');
  return 0;
}
