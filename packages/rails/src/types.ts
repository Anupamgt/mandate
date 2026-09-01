import { asPaise, type Paise } from "@mandate/shared";

export type Quote = {
  amountPaise: Paise;
  counterpartyId: string;
};

export type RailSettlement = {
  railId: string;
  externalRef: string;
  amountPaise: Paise;
  idempotencyKey: string;
};

export type ReverseResult = {
  externalRef: string;
  succeeded: boolean;
  amountPaise: Paise;
};

export interface Rail {
  quote(amountPaise: Paise, counterpartyId: string): Promise<Quote>;
  pay(quote: Quote, mandateId: string, idempotencyKey: string): Promise<RailSettlement>;
  reverse(settlement: RailSettlement, reason: string): Promise<ReverseResult>;
}
