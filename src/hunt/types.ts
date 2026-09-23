/**
 * `buggo hunt` result shape - deliberately separate from core/types.ts's
 * `Case` (investigate's result), since hunt has no bug report and its
 * output is a prioritized list of files worth investigating, not a ranked
 * set of suspects for a known bug.
 */
export type HuntSuspect = {
  rank: number;
  path: string;
  probability: number;
  riskSignal: string | null; // the observed evidence line shown to Jev (see risk-signal.ts), null if the file had no git history signal
};

export type HuntStatus = 'TRIAGED' | 'FAILED';

export type HuntResult = {
  schemaVersion: '1';
  huntId: string;
  createdAt: string;
  status: HuntStatus;
  repository: {
    root: string;
    productionFileCount: number;
  };
  suspects: HuntSuspect[];
  costs: { jevCalls: number; costUsd: number };
  timingsMs: { total: number };
  error: { message: string } | null;
  /**
   * Explicit reminder in the result itself, not just documentation: hunt
   * triage is a structural risk estimate, not a discovered bug. Nothing
   * here has been reproduced.
   */
  disclaimer: string;
};
