/**
 * Blind (no bug report) correctness-risk signal for `buggo hunt`, derived
 * from git history: how often a file has been touched, and how many of
 * those commits look like bug fixes.
 *
 * Validated before being wired into hunt/triage.ts: on 100 real BugsJS bugs
 * (Phase 3B's frozen research sample), the file that actually contained the
 * bug fell in the riskiest 10% of the repo's candidates 63% of the time by
 * this signal alone (vs. ~10% expected by chance), and had at least one
 * historical fix-commit touching it 94% of the time. Showing this signal to
 * Jev (instead of the naive `criteria: null` a purely blind triage would
 * otherwise send) raised file-level Top-5 triage accuracy from 10% to 60%
 * on a 30-bug multi-project sample (McNemar p=0.0007). See the Buggo Tests
 * research repo's results/pilot-hunt-risk-signal-wide.json for the full
 * numbers this is based on.
 *
 * Known limitation, disclosed rather than silently ignored: this signal
 * favors large, frequently-touched "core" files (e.g. a project's main
 * entry point or central config) simply because they get touched often for
 * unrelated reasons (features, refactors, docs) - not because they're more
 * bug-prone. In repos with a "many small peripheral files, one shared core"
 * shape (e.g. a linter with hundreds of individual rule files), this
 * signal can miss a bug in a rarely-touched peripheral file in favor of a
 * heavily-touched core file. Two correction attempts (size-normalized
 * density, and a minimum-churn threshold) were tried and measured to be no
 * better (density normalization was measurably worse) - not fixed here,
 * left as a known, real trade-off rather than papered over.
 *
 * Read-only, best-effort, and bounded (-n 500 commits) - same contract as
 * repo/git-signal.ts's getGitRecency: a non-git repo, a shallow clone, or a
 * missing git binary just means no signal for any file, never a failure.
 */
import { execFileSync } from 'node:child_process';

export type FileRiskSignal = { churnCount: number; fixCommitCount: number };
export type RiskSignalMap = Map<string, FileRiskSignal>;

const FIX_PATTERN = /\b(fix(es|ed)?|bugfix|hotfix|bug)\b/i;
const HISTORY_WINDOW = 500;

function isGitRepo(root: string): boolean {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/** relPath -> {churnCount, fixCommitCount} over the last HISTORY_WINDOW
 * commits. Best-effort: non-git repo / missing git / corrupt history all
 * yield an empty map (no signal), never a thrown error. */
export function getFileRiskSignal(root: string): RiskSignalMap {
  const result: RiskSignalMap = new Map();
  if (!isGitRepo(root)) return result;

  let output: string;
  try {
    // %x01 marks each commit's subject line so it's unambiguous against a
    // touched-file path line (git log's default --name-only separator).
    output = execFileSync(
      'git',
      ['-C', root, 'log', '-n', String(HISTORY_WINDOW), '--name-only', '--format=%x01%s'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return result;
  }

  let currentIsFix = false;
  for (const line of output.split('\n')) {
    if (line.startsWith('\x01')) {
      currentIsFix = FIX_PATTERN.test(line.slice(1));
      continue;
    }
    const relPath = line.trim();
    if (!relPath) continue;
    const existing = result.get(relPath) ?? { churnCount: 0, fixCommitCount: 0 };
    existing.churnCount += 1;
    if (currentIsFix) existing.fixCommitCount += 1;
    result.set(relPath, existing);
  }

  return result;
}

/** Short descriptive phrase for a file's risk signal, for use as Jev
 * criteria text - describes observed history, never a probability or a
 * pre-judged verdict. Returns null when there's no signal at all (file
 * untouched in the window, or no git). */
export function describeRiskSignal(signal: FileRiskSignal | undefined): string | null {
  if (!signal || signal.churnCount === 0) return null;
  const parts: string[] = [`touched in ${signal.churnCount} of the last ${HISTORY_WINDOW} commits`];
  if (signal.fixCommitCount > 0) {
    parts.push(`${signal.fixCommitCount} of those commit messages look like bug fixes`);
  }
  return parts.join(', ');
}
