/**
 * Product-side stand-in for research's BugRecord (src/benchmark/dataset.ts).
 *
 * Only carries the fields the copied V3 pipeline actually reads:
 * bug_description, error_message, stack_trace. Deliberately does NOT include
 * files_changed_by_real_fix / functions_changed_by_real_fix (ground truth) -
 * those fields exist only on the research-side BugRecord and must never be
 * reachable from product code, per the anti-leakage boundary documented in
 * the main repo's CLAUDE.md.
 */
export type BugRecord = {
  bug_id: string;
  bug_description: string;
  error_message: string | null;
  stack_trace: string | null;
  /** Files the caller already flagged as suspects (--diff/--recent-changes), if any. */
  hinted_files: string[];
};
