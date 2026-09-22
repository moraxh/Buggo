/**
 * Argument parsing only - no output formatting, no investigation logic.
 * Kept separate so both the human and JSON entry points parse args the
 * same way.
 */
import { readFileSync, existsSync } from 'node:fs';

export type ParsedArgs = {
  description: string;
  errorMessage?: string;
  stackTrace?: string;
  failingTest?: string;
  repoRoot: string;
  format: 'human' | 'json';
  /** Raw --diff ref (e.g. "HEAD~3", "main..feature"), resolved to file paths later once repoRoot is known (see investigate-command.ts). */
  diffRef?: string;
  /** --recent-changes <n>: how many recent commits' touched files to hint at; same late-resolution as diffRef. */
  recentChangesCount?: number;
  /** --exclude <file> (repeatable): candidate files to drop from the pool before ranking, e.g. to re-run after ruling out a previous suspect. */
  excludedFiles: string[];
};

export class ArgsError extends Error {}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  if (value === undefined) throw new ArgsError(`${flag} requires a value`);
  return value;
}

/** Like readFlagValue, but collects every occurrence (--exclude a --exclude b -> ['a', 'b']) instead of just the first. */
function readFlagValues(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    const value = argv[i + 1];
    if (value === undefined) throw new ArgsError(`${flag} requires a value`);
    values.push(value);
  }
  return values;
}

/** Shared by investigate/show so an invalid --format is always a hard error, never a silent fallback. */
export function parseFormatFlag(argv: string[]): 'human' | 'json' {
  const format = readFlagValue(argv, '--format');
  if (format === undefined) return 'human';
  if (format !== 'human' && format !== 'json') {
    throw new ArgsError(`--format must be "human" or "json", got "${format}"`);
  }
  return format;
}

/** --stack accepts either a file path or literal text, per spec section 9. */
function resolveStackTrace(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (existsSync(raw)) return readFileSync(raw, 'utf-8');
  return raw;
}

/** Every flag investigate accepts that consumes the following token as its value. */
const INVESTIGATE_VALUE_FLAGS = new Set([
  '--error', '--stack', '--test', '--repo', '--format', '--diff', '--recent-changes', '--exclude',
]);

/** Every flag show accepts that consumes the following token as its value. */
export const SHOW_VALUE_FLAGS = new Set(['--format']);

/** Every flag cases accepts that consumes the following token as its value. */
export const CASES_VALUE_FLAGS = new Set(['--status', '--since', '--search', '--limit']);

const VALID_STATUSES = new Set(['OPEN', 'SCANNING', 'LOCALIZING', 'LOCALIZED', 'FAILED']);

export type CasesFilters = {
  status?: 'OPEN' | 'SCANNING' | 'LOCALIZING' | 'LOCALIZED' | 'FAILED';
  since?: Date;
  search?: string;
  limit?: number;
};

/** --since accepts anything Date can parse (e.g. "2026-09-01"); rejects garbage rather than silently matching nothing. */
export function parseCasesFilters(argv: string[]): CasesFilters {
  const filters: CasesFilters = {};

  const status = readFlagValue(argv, '--status');
  if (status !== undefined) {
    const upper = status.toUpperCase();
    if (!VALID_STATUSES.has(upper)) {
      throw new ArgsError(`--status must be one of ${[...VALID_STATUSES].join(', ')}, got "${status}"`);
    }
    filters.status = upper as CasesFilters['status'];
  }

  const since = readFlagValue(argv, '--since');
  if (since !== undefined) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new ArgsError(`--since must be a valid date, got "${since}"`);
    }
    filters.since = parsed;
  }

  const search = readFlagValue(argv, '--search');
  if (search !== undefined) filters.search = search;

  const limit = readFlagValue(argv, '--limit');
  if (limit !== undefined) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ArgsError(`--limit must be a positive integer, got "${limit}"`);
    }
    filters.limit = parsed;
  }

  return filters;
}

/**
 * Extracts positional (non-flag) arguments, skipping each known value
 * flag's value along with the flag itself. Driven by an explicit
 * known-flags list rather than "does the previous token start with -", so
 * a flag's own value (e.g. "json" in "--format json") is never mistaken
 * for a positional argument - which is what caused two separate bugs
 * before this helper existed: parseInvestigateArgs treating a flag's value
 * as the bug description, and runShowCommand treating a flag's value as
 * the caseId when the real caseId argument was omitted.
 */
export function extractPositionals(argv: string[], valueFlags: ReadonlySet<string>): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (valueFlags.has(token)) {
      i++; // skip this flag's value
      continue;
    }
    if (token.startsWith('-')) continue; // unknown/boolean flag
    positionals.push(token);
  }
  return positionals;
}

export function parseInvestigateArgs(argv: string[]): ParsedArgs {
  const positionals = extractPositionals(argv, INVESTIGATE_VALUE_FLAGS);

  const description = positionals[0];
  if (!description) {
    throw new ArgsError('A bug description is required: buggo investigate "<description>"');
  }
  if (positionals.length > 1) {
    throw new ArgsError(`Unexpected extra argument(s): ${positionals.slice(1).join(', ')}`);
  }

  const recentChangesRaw = readFlagValue(argv, '--recent-changes');
  let recentChangesCount: number | undefined;
  if (recentChangesRaw !== undefined) {
    const parsed = Number(recentChangesRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ArgsError(`--recent-changes must be a positive integer, got "${recentChangesRaw}"`);
    }
    recentChangesCount = parsed;
  }

  return {
    description,
    errorMessage: readFlagValue(argv, '--error'),
    stackTrace: resolveStackTrace(readFlagValue(argv, '--stack')),
    failingTest: readFlagValue(argv, '--test'),
    repoRoot: readFlagValue(argv, '--repo') ?? process.cwd(),
    format: parseFormatFlag(argv),
    diffRef: readFlagValue(argv, '--diff'),
    recentChangesCount,
    excludedFiles: readFlagValues(argv, '--exclude'),
  };
}
