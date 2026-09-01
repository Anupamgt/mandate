import type { Paise } from "@mandate/shared";

export type Quote = {
  amountPaise: Paise;
  counterpartyId: string;
};

export type Settlement = {
  externalRef: string;
  amountPaise: Paise;
  idempotencyKey: string;
};

/** FR-30. RazorpayTestRail (s2s_order) + MockRail land after T-001. */
export interface Rail {
  quote(): Promise<Quote>;
  pay(quote: Quote, mandateId: string, idempotencyKey: string): Promise<Settlement>;
  reverse(settlement: Settlement, reason: string): Promise<{ externalRef: string; succeeded: boolean }>;
}
