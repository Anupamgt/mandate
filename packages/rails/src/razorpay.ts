import { asPaise, type Paise } from "@mandate/shared";
import type { Quote, Rail, RailSettlement, ReverseResult } from "./types.js";

export type RazorpayFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type RazorpayTestRailOptions = {
  keyId: string;
  keySecret: string;
  fetchImpl?: RazorpayFetch;
  baseUrl?: string;
};

function basicAuth(keyId: string, keySecret: string): string {
  return Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

/**
 * Day-0 rail: s2s_order. pay() = create order + test payment. reverse() = refund.
 */
export class RazorpayTestRail implements Rail {
  readonly id = "razorpay_s2s_order";
  private readonly paid = new Map<string, RailSettlement>();
  private readonly opts: Required<Pick<RazorpayTestRailOptions, "keyId" | "keySecret">> & {
    fetchImpl: RazorpayFetch;
    baseUrl: string;
  };

  constructor(opts: RazorpayTestRailOptions) {
    if (!opts.keyId.startsWith("rzp_test_")) {
      throw new Error("live keys are forbidden");
    }
    this.opts = {
      keyId: opts.keyId,
      keySecret: opts.keySecret,
      fetchImpl: opts.fetchImpl ?? fetch,
      baseUrl: opts.baseUrl ?? "https://api.razorpay.com",
    };
  }

  async quote(amountPaise: Paise, counterpartyId: string): Promise<Quote> {
    return { amountPaise, counterpartyId };
  }

  async pay(quote: Quote, mandateId: string, idempotencyKey: string): Promise<RailSettlement> {
    const existing = this.paid.get(idempotencyKey);
    if (existing) return existing;

    const order = await this.api("POST", "/v1/orders", {
      amount: quote.amountPaise,
      currency: "INR",
      receipt: idempotencyKey.slice(0, 40),
      notes: { mandate_id: mandateId, invoice_id: idempotencyKey },
    });
    const orderId = String(order.id);
    const payment = await this.api("POST", "/v1/payments/create/json", {
      amount: quote.amountPaise,
      currency: "INR",
      order_id: orderId,
      email: "agent@mandate.test",
      contact: "+919999999999",
      method: "card",
      card: {
        number: "4111111111111111",
        expiry_month: "12",
        expiry_year: "29",
        cvv: "123",
        name: "Mandate Test",
      },
    });
    const settlement: RailSettlement = {
      railId: this.id,
      externalRef: String(payment.id ?? orderId),
      amountPaise: asPaise(quote.amountPaise),
      idempotencyKey,
    };
    this.paid.set(idempotencyKey, settlement);
    return settlement;
  }

  async reverse(settlement: RailSettlement, reason: string): Promise<ReverseResult> {
    try {
      const refund = await this.api("POST", `/v1/payments/${settlement.externalRef}/refund`, {
        amount: settlement.amountPaise,
        notes: { reason: reason.slice(0, 256) },
      });
      return {
        externalRef: String(refund.id),
        succeeded: true,
        amountPaise: asPaise(settlement.amountPaise),
      };
    } catch {
      return {
        externalRef: "",
        succeeded: false,
        amountPaise: asPaise(settlement.amountPaise),
      };
    }
  }

  private async api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.opts.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${basicAuth(this.opts.keyId, this.opts.keySecret)}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`razorpay ${path} ${res.status}`);
    }
    return json;
  }
}
