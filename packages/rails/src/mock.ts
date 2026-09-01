import { asPaise, type Paise } from "@mandate/shared";
import type { Quote, Rail, RailSettlement, ReverseResult } from "./types.js";

export type MockRailOptions = {
  payFails?: boolean;
  reverseFails?: boolean;
  latencyMs?: number;
};

export class MockRail implements Rail {
  readonly id = "mock";
  private seq = 0;
  private readonly paid = new Map<string, RailSettlement>();
  private readonly reversed = new Map<string, ReverseResult>();
  options: MockRailOptions;

  constructor(options: MockRailOptions = {}) {
    this.options = options;
  }

  async quote(amountPaise: Paise, counterpartyId: string): Promise<Quote> {
    return { amountPaise, counterpartyId };
  }

  async pay(quote: Quote, _mandateId: string, idempotencyKey: string): Promise<RailSettlement> {
    const existing = this.paid.get(idempotencyKey);
    if (existing) return existing;
    if (this.options.payFails) {
      throw new Error("mock pay failed");
    }
    this.seq += 1;
    const settlement: RailSettlement = {
      railId: this.id,
      externalRef: `mock_pay_${this.seq}`,
      amountPaise: asPaise(quote.amountPaise),
      idempotencyKey,
    };
    this.paid.set(idempotencyKey, settlement);
    return settlement;
  }

  async reverse(settlement: RailSettlement, reason: string): Promise<ReverseResult> {
    const existing = this.reversed.get(settlement.idempotencyKey);
    if (existing) return existing;
    const result: ReverseResult = {
      externalRef: `mock_rev_${settlement.externalRef}`,
      succeeded: !this.options.reverseFails,
      amountPaise: asPaise(settlement.amountPaise),
    };
    if (!result.succeeded) {
      return { ...result, externalRef: `mock_rev_fail:${reason}` };
    }
    this.reversed.set(settlement.idempotencyKey, result);
    return result;
  }
}
