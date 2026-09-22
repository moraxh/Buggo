import { readdirSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const CASES_DIR = join('.buggo', 'cases');
const MAX_ATTEMPTS = 10_000;

/**
 * BG-0001, BG-0002, ... allocated atomically via an exclusive-create lock
 * file per candidate id, so two concurrent investigate() calls can never
 * both claim the same id (a plain "count existing files, add one" scheme
 * has a read-then-write race: both callers can read the same count before
 * either has saved its case, and the second save silently overwrites the
 * first). openSync(path, 'wx') fails if the path already exists, which is
 * atomic at the filesystem level - no separate lock needed.
 */
export function nextCaseId(): string {
  mkdirSync(CASES_DIR, { recursive: true });

  const n0 = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).length + 1;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const n = n0 + attempt;
    const id = `BG-${String(n).padStart(4, '0')}`;
    const lockPath = join(CASES_DIR, `${id}.lock`);
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return id;
    } catch (err) {
      // EEXIST means another caller (or a stale case file) already claimed
      // this specific id - that's the expected race we're guarding against,
      // so just try the next id. Any other error (EACCES, EROFS, disk full,
      // ...) is not a collision and will not resolve itself by incrementing
      // n forever, so it must propagate instead of spinning indefinitely.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  throw new Error(`Could not allocate a case id after ${MAX_ATTEMPTS} attempts`);
}
