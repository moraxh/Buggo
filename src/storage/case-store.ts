/**
 * Local case persistence: .buggo/cases/BG-000N.json, one file per case.
 * No database, no cloud state, no accounts - cases are plain JSON files,
 * inspectable and portable (spec section 21).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Case } from '../core/types.js';

const CASES_DIR = join('.buggo', 'cases');

export function saveCase(kase: Case): void {
  mkdirSync(CASES_DIR, { recursive: true });
  writeFileSync(join(CASES_DIR, `${kase.caseId}.json`), JSON.stringify(kase, null, 2));
  // Release the id-allocation lock (see core/case-id.ts) now that the real
  // case file exists - readdirSync's .json filter already ignores .lock
  // files, but there's no reason to leave them on disk once claimed.
  rmSync(join(CASES_DIR, `${kase.caseId}.lock`), { force: true });
}

export function loadCase(caseId: string): Case | null {
  const path = join(CASES_DIR, `${caseId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export type CaseSummary = {
  caseId: string;
  createdAt: string;
  status: Case['status'];
  description: string;
  topSuspect: string | null;
};

/**
 * `limit`, when given, keeps only the `limit` most recently created cases
 * (case filenames are BG-000N, so a lexical sort is also chronological) and
 * reads/parses only those files - listCases() previously read and parsed
 * every case's full JSON (including its entire suspects/evidence/decisions
 * arrays) just to print a one-line summary, which gets noticeably slower
 * as case history grows. Omit `limit` to keep the old read-everything
 * behavior for callers that need the full history.
 */
export type ListCasesOptions = {
  limit?: number;
  /** Keep only cases whose status matches exactly. */
  status?: Case['status'];
  /** Keep only cases created at or after this instant. */
  since?: Date;
  /** Case-insensitive substring match against the bug description. */
  search?: string;
};

/**
 * Filters (status/since/search) are applied before `limit`, so `limit`
 * always means "the N most recent matches", not "the N most recent cases,
 * then filtered down further". Filtering requires reading every case's
 * JSON (unlike the old limit-only fast path) since status/description/
 * createdAt aren't recoverable from the filename alone.
 */
export function listCases(options: ListCasesOptions = {}): CaseSummary[] {
  if (!existsSync(CASES_DIR)) return [];
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
  const hasFilters = options.status !== undefined || options.since !== undefined || options.search !== undefined;

  const toSummary = (f: string): CaseSummary => {
    const kase: Case = JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8'));
    return {
      caseId: kase.caseId,
      createdAt: kase.createdAt,
      status: kase.status,
      description: kase.report.description,
      topSuspect: kase.localization?.suspects[0]?.path ?? null,
    };
  };

  if (!hasFilters) {
    const limited = options.limit !== undefined ? files.slice(-options.limit) : files;
    return limited.map(toSummary);
  }

  const search = options.search?.toLowerCase();
  let summaries = files
    .map(toSummary)
    .filter((s) => options.status === undefined || s.status === options.status)
    .filter((s) => options.since === undefined || new Date(s.createdAt) >= options.since!)
    .filter((s) => search === undefined || s.description.toLowerCase().includes(search));

  if (options.limit !== undefined) {
    summaries = summaries.slice(-options.limit);
  }
  return summaries;
}
