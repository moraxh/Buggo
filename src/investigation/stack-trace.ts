/**
 * Extracts file paths mentioned in a stack trace and matches them against
 * the repo's actual candidate files. A stack trace naming a real candidate
 * is about as strong a localization signal as exists - stronger than any
 * Jev judgment - so matched files are surfaced as `path_match` evidence
 * (observed, not a model decision) and fed into file ranking as an extra
 * criterion, not a replacement for it (a stack trace can point at a
 * downstream symptom, not the actual root cause).
 */

/**
 * Matches JS/TS ("at foo (src/bar.ts:12:5)", "src/bar.js:12") and Python
 * ('File "app/bar.py", line 12') stack frame path patterns. Deliberately
 * permissive on the surrounding syntax (different runtimes/formatters
 * vary), strict on requiring a plausible file extension so it doesn't
 * match arbitrary words that happen to contain a colon.
 */
const JS_FRAME = /(?:^|[\s(])([^\s():]+\.(?:[jt]sx?|mjs|cjs))(?::\d+)?(?::\d+)?/g;
const PY_FRAME = /File "([^"]+\.py)"/g;

/** Extracts every distinct file path mentioned in a stack trace, in first-seen order. Best-effort: an unparseable or empty trace just yields no paths. */
export function extractStackTracePaths(stackTrace: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const re of [JS_FRAME, PY_FRAME]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(stackTrace)) !== null) {
      const raw = match[1];
      if (!seen.has(raw)) {
        seen.add(raw);
        paths.push(raw);
      }
    }
  }

  return paths;
}

/**
 * Fuzzy-matches a list of raw paths (from a stack trace, a diff, or
 * anywhere else) against the repo's real candidate files. A raw path is
 * rarely repo-root-relative as-is (it may be absolute, or relative to a
 * build output dir) - matching by path suffix against the known candidate
 * list is more robust than requiring an exact match, at the cost of
 * occasionally matching the wrong file with the same basename in a
 * different directory (acceptable: this is an extra signal, not the sole
 * source of truth).
 */
export function fuzzyMatchPathsToCandidates(rawPaths: string[], candidateFiles: string[]): string[] {
  if (rawPaths.length === 0) return [];

  const matched: string[] = [];
  const matchedSet = new Set<string>();
  for (const rawPath of rawPaths) {
    const normalized = rawPath.replace(/\\/g, '/');
    for (const candidate of candidateFiles) {
      if (matchedSet.has(candidate)) continue;
      if (normalized === candidate || normalized.endsWith('/' + candidate) || candidate.endsWith('/' + normalized)) {
        matched.push(candidate);
        matchedSet.add(candidate);
      }
    }
  }
  return matched;
}

/** Matches stack trace frame paths against the repo's real candidate files. */
export function matchStackTraceToCandidates(stackTrace: string, candidateFiles: string[]): string[] {
  return fuzzyMatchPathsToCandidates(extractStackTracePaths(stackTrace), candidateFiles);
}
