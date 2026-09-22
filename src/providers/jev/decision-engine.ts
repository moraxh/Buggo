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

export class JevDecisionEngine implements DecisionEngine {
  private client: JevClient;

  constructor(caseId: string) {
    this.client = new JevClient(caseId);
  }

  ask(label: string, req: JevRequest): Promise<JevResponse> {
    return this.client.ask(label, req);
  }

  getCallLog(): CallLogEntry[] {
    return this.client.getCallLog();
  }

  getTotals(): { calls: number; cost: number } {
    return this.client.getTotals();
  }
}
