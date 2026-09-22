/**
 * Thin abstraction over the concrete Jev client so investigation code isn't
 * tightly coupled to OpenRouter/one provider/one model id. The localization
 * pipeline (investigation/*) is written against JevClient directly (copied
 * unmodified from research) - this interface exists so a future provider
 * swap only has to change this file plus the class below, not the pipeline.
 */
import { JevClient, type JevRequest, type JevResponse, type CallLogEntry } from '../../jev/client.js';

export interface DecisionEngine {
  ask(label: string, req: JevRequest): Promise<JevResponse>;
  getCallLog(): CallLogEntry[];
  getTotals(): { calls: number; cost: number };
}

/**
 * Fired around each ask() call so a live-updating renderer (the CLI's
 * detective view) can show investigation progress as it happens, instead
 * of only the final result. Purely observational - never affects the
 * pipeline's control flow or the Case that comes out of it.
 */
export type EngineProgressListener = {
  onPhaseStart?: (label: string) => void;
  onPhaseEnd?: (label: string, ok: boolean) => void;
};

export class JevDecisionEngine implements DecisionEngine {
  private client: JevClient;
  private listener?: EngineProgressListener;

  constructor(caseId: string, listener?: EngineProgressListener) {
    this.client = new JevClient(caseId);
    this.listener = listener;
  }

  async ask(label: string, req: JevRequest): Promise<JevResponse> {
    this.listener?.onPhaseStart?.(label);
    try {
      const res = await this.client.ask(label, req);
      this.listener?.onPhaseEnd?.(label, true);
      return res;
    } catch (err) {
      this.listener?.onPhaseEnd?.(label, false);
      throw err;
    }
  }

  getCallLog(): CallLogEntry[] {
    return this.client.getCallLog();
  }

  getTotals(): { calls: number; cost: number } {
    return this.client.getTotals();
  }
}
