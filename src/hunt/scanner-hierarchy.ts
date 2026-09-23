/**
 * `buggo hunt`: hierarchical search-unit construction, ground-truth-blind.
 *
 * Reuses the existing scanner (repo/scanner.ts, repo/ast.ts) unmodified.
 * Builds a repository -> directory/module -> file hierarchy so Jev triage
 * can operate at whatever granularity keeps each decision's candidate
 * count within Jev's practical per-call limits, without any heuristic
 * pre-filtering that could silently drop a region before Jev ever judges
 * it (the same anti-pattern investigate's chunked file-ranking exists to
 * avoid - see investigation/files-chunked.ts).
 */
import { scanRepo, listCandidateFiles, type RepoScan } from '../repo/scanner.js';
import { dirname } from 'node:path';

export type ModuleGroup = {
  moduleDir: string; // top-level-ish directory grouping, e.g. "lib/rules", "src/core"
  files: string[];
};

/** Groups candidate files by their directory, without using any bug-specific
 * signal - purely structural, so it cannot leak ground truth. Deep paths
 * are grouped by their first two path segments (e.g. "lib/rules/foo.js" and
 * "lib/rules/bar.js" both group under "lib/rules") to keep group counts
 * manageable on large repos without an arbitrary depth-1 grouping that
 * would dump hundreds of files into one bucket like "lib". */
export function buildModuleGroups(scan: RepoScan): ModuleGroup[] {
  const files = listCandidateFiles(scan);
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split('/');
    const groupKey = parts.length > 2 ? parts.slice(0, 2).join('/') : dirname(f);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(f);
  }
  return [...groups.entries()].map(([moduleDir, groupFiles]) => ({ moduleDir, files: groupFiles }));
}

export function scanRepoForHunt(repoRoot: string): { scan: RepoScan; groups: ModuleGroup[]; totalFiles: number } {
  const scan = scanRepo(repoRoot);
  const groups = buildModuleGroups(scan);
  const totalFiles = listCandidateFiles(scan).length;
  return { scan, groups, totalFiles };
}
