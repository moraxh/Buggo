import { config as loadDotenv } from 'dotenv';
import { readUserConfig } from './storage/user-config.js';
loadDotenv({ quiet: true });

function resolveApiKey(): string {
  if (process.env.JEV_AI_KEY) return process.env.JEV_AI_KEY;
  return readUserConfig().jevApiKey ?? '';
}

export const config = {
  jevApiKey: resolveApiKey(),
  jevEndpoint: 'https://openrouter.ai/api/alpha/decisions',
  jevModel: 'typesafe/jev-1.13',

  // Safety limits (spec section 15)
  // V3 note: chunked file ranking (src/investigation/files-chunked.ts) for
  // VERY_LARGE repos needs roughly ceil(candidates/40) chunk calls + up to
  // one recursion level of finalist re-ranking + subsystem + function calls
  // - a ~1000-file repo needs ~30 calls, exceeding V1/V2's 25 cap (which was
  // sized for a single-prefilter-call pipeline). Raised with margin; cost
  // stays trivial since even 40 calls at Jev's real per-call cost
  // (~$0.0002-0.0005, per Phase 1-3 measurements) is well under $0.02/bug.
  maxCallsPerBug: 45,
  maxCostPerBugUsd: 0.05,
  requestTimeoutMs: 20_000,
  maxRetries: 3,
  retryBaseDelayMs: 500,

  // Repo intelligence limits (spec section 5)
  maxCharsPerFileSummary: 4_000,
  maxTotalStructuralChars: 24_000,
  maxCandidateFiles: 40,
  maxFunctionsPerFile: 60,

  cacheDir: '.buggo/cache',
};

export function requireApiKey(): string {
  if (!config.jevApiKey) {
    throw new Error(
      'No API key found. Run `buggo config set-key <your-openrouter-key>`, ' +
        'or set the JEV_AI_KEY environment variable.'
    );
  }
  return config.jevApiKey;
}
