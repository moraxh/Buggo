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
export function listCases(options: { limit?: number } = {}): CaseSummary[] {
  if (!existsSync(CASES_DIR)) return [];
  let files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
  if (options.limit !== undefined) {
    files = files.slice(-options.limit);
  }
  return files.map((f) => {
    const kase: Case = JSON.parse(readFileSync(join(CASES_DIR, f), 'utf-8'));
    return {
      caseId: kase.caseId,
      createdAt: kase.createdAt,
      status: kase.status,
      description: kase.report.description,
      topSuspect: kase.localization?.suspects[0]?.path ?? null,
    };
  });
}
