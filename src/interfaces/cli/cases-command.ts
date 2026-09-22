/**
 * `buggo cases` and `buggo show <caseId>` - lightweight inspection of
 * locally persisted cases. Not a case-management app: list and show only.
 */
import { listCases, loadCase } from '../../storage/case-store.js';
import { toAgentJsonString } from '../json/format.js';
import { renderCasesView } from './cases-view.js';
import { renderShowView } from './show-view.js';
import { parseFormatFlag, parseCasesFilters, extractPositionals, SHOW_VALUE_FLAGS, ArgsError } from './args.js';

const DEFAULT_CASES_SHOWN = 50;

export function runCasesCommand(argv: string[] = []): number {
  let filters;
  try {
    filters = parseCasesFilters(argv);
  } catch (err) {
    if (err instanceof ArgsError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const limit = filters.limit ?? DEFAULT_CASES_SHOWN;
  const cases = listCases({ ...filters, limit });

  const note =
    cases.length === 0
      ? Object.keys(filters).length > 0
        ? 'No cases match those filters.'
        : 'No cases yet. Run: buggo investigate "<description>"'
      : cases.length === limit
        ? `(showing the ${limit} most recent matching cases; see .buggo/cases/ for the full history)`
        : null;

  renderCasesView(cases, note);
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

  renderShowView(kase);
  return 0;
}
