/**
 * Optional git-recency signal: "days since this file was last touched",
 * added to the per-file description Jev already sees (alongside exports/
 * functions) - a file changed 2 days ago is a more plausible culprit for a
 * freshly reported bug than one untouched for a year. Never required: a
 * non-git repo, a shallow clone, or a missing git binary just means every
 * file has no recency signal, exactly as if this module didn't exist.
 *
 * Read-only, best-effort, and bounded (-n 500 commits) so a repo with a
 * huge history doesn't turn a cheap scan into a slow `git log` walk.
 */
import { execFileSync } from 'node:child_process';

export type GitRecency = Map<string, number>; // relPath -> days since last commit touching it

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

/**
 * Returns relPath -> days since the file's most recent commit, for every
 * file touched in the last 500 commits. Files never touched in that window
 * (or the repo isn't git, or git isn't available) are simply absent from
 * the map - callers must treat "no entry" as "no signal", not "very old".
 */
export function getGitRecency(root: string): GitRecency {
  const recency: GitRecency = new Map();
  if (!isGitRepo(root)) return recency;

  let output: string;
  try {
    // %ct = committer date, unix seconds; one line per commit, then its
    // touched files, blank line between commits (git log's default
    // --name-only separator).
    output = execFileSync(
      'git',
      ['-C', root, 'log', '-n', '500', '--name-only', '--format=%x01%ct'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return recency; // detached HEAD with no commits, corrupt repo, etc. - just no signal
  }

  const nowSec = Date.now() / 1000;
  let currentCommitSec: number | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('\x01')) {
      const sec = Number(line.slice(1));
      currentCommitSec = Number.isFinite(sec) ? sec : null;
      continue;
    }
    if (!line.trim() || currentCommitSec === null) continue;
    // git log processes newest-first, so the first time we see a path is
    // its most recent touch - never overwrite an existing (more recent) entry.
    if (!recency.has(line)) {
      recency.set(line, Math.max(0, Math.floor((nowSec - currentCommitSec) / 86400)));
    }
  }

  return recency;
}

/**
 * Files touched by a diff ref (a commit, range like "main..feature", or
 * anything `git diff --name-only` accepts). Read-only, best-effort: an
 * invalid ref, a non-git repo, or a missing git binary all just yield no
 * hints - never throws, since this is caller-provided extra context, not
 * a required input.
 */
export function getDiffFiles(root: string, ref: string): string[] {
  if (!isGitRepo(root)) return [];
  try {
    const out = execFileSync('git', ['-C', root, 'diff', '--name-only', ref], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return out.split('\n').filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

/** Files touched across the last `count` commits (HEAD backwards), deduplicated. Same best-effort contract as getDiffFiles. */
export function getRecentlyChangedFiles(root: string, count: number): string[] {
  if (!isGitRepo(root)) return [];
  try {
    const out = execFileSync(
      'git',
      ['-C', root, 'log', '-n', String(count), '--name-only', '--pretty=format:'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }
    );
    const seen = new Set<string>();
    const files: string[] = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      files.push(trimmed);
    }
    return files;
  } catch {
    return [];
  }
}

/** Short human phrase for a days-since-touched value, used in the per-file description sent to Jev. */
export function describeRecency(days: number): string {
  if (days === 0) return 'modified today';
  if (days === 1) return 'modified yesterday';
  if (days <= 7) return `modified ${days} days ago`;
  if (days <= 30) return `modified ${Math.round(days / 7)} weeks ago`;
  if (days <= 365) return `modified ${Math.round(days / 30)} months ago`;
  return `modified over a year ago`;
}
