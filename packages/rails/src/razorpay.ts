import { asPaise, type Paise } from "@mandate/shared";
import type { Quote, Rail, RailSettlement, ReverseResult } from "./types.js";

export type RazorpayFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type RazorpayTestRailOptions = {
  keyId: string;
  keySecret: string;
  fetchImpl?: RazorpayFetch;
  baseUrl?: string;
};

/** Razorpay India domestic test Visa. 4111… is treated as international and is declined. */
const INR_TEST_CARD = {
  number: "4386289407660153",
  name: "Mandate Test",
  expiry_month: "12",
  expiry_year: "30",
  cvv: "123",
} as const;

const TEST_CONTACT = "9000090000";
const TEST_EMAIL = "gaurav.kumar@example.com";
/** Razorpay test-mode 4-digit OTP always succeeds. */
const TEST_OTP = "1234";

function basicAuth(keyId: string, keySecret: string): string {
  return Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

function paymentRef(payload: Record<string, unknown> | null, html = ""): string {
  const fromJson = payload?.id ?? payload?.razorpay_payment_id;
  if (fromJson != null && String(fromJson).length > 0) return String(fromJson);
  const fromHtml = html.match(/pay_[A-Za-z0-9]+/);
  return fromHtml?.[0] ?? "";
}

function otpSubmitUrl(payload: Record<string, unknown> | null, html = ""): string | null {
  const next = payload?.next;
  if (Array.isArray(next)) {
    for (const item of next) {
      if (item && typeof item === "object" && "action" in item && "url" in item) {
        const action = String((item as { action: unknown }).action);
        const url = String((item as { url: unknown }).url);
        if (action === "otp_submit" && url.startsWith("http")) return url;
      }
    }
  }
  const action = html.match(/action=["']([^"']+)/)?.[1];
  return action && action.includes("otp_submit") ? action : null;
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
      payment_capture: 1,
      notes: { mandate_id: mandateId, invoice_id: idempotencyKey },
    });
    const orderId = String(order.id);
    const externalRef = await this.createTestPayment(orderId, quote.amountPaise);
    if (!externalRef) {
      throw new Error("razorpay pay missing externalRef");
    }
    const settlement: RailSettlement = {
      railId: this.id,
      externalRef,
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

  private jsonPaymentBody(orderId: string, amountPaise: Paise): Record<string, unknown> {
    return {
      amount: amountPaise,
      currency: "INR",
      order_id: orderId,
      email: TEST_EMAIL,
      contact: TEST_CONTACT,
      method: "card",
      card: INR_TEST_CARD,
      authentication: { authentication_channel: "browser" },
      browser: {
        java_enabled: false,
        javascript_enabled: true,
        timezone_offset: 330,
        color_depth: 24,
        screen_width: 1366,
        screen_height: 768,
      },
      ip: "49.36.1.1",
    };
  }

  private async createTestPayment(orderId: string, amountPaise: Paise): Promise<string> {
    const jsonAttempt = await this.request("POST", "/v1/payments/create/json", {
      json: this.jsonPaymentBody(orderId, amountPaise),
    });
    if (jsonAttempt.ok) {
      const ref = paymentRef(jsonAttempt.json, jsonAttempt.text);
      await this.completeTestOtp(jsonAttempt.json, jsonAttempt.text);
      return ref;
    }

    const form = await this.request("POST", "/v1/payments", {
      form: {
        amount: String(amountPaise),
        currency: "INR",
        order_id: orderId,
        email: TEST_EMAIL,
        contact: TEST_CONTACT,
        method: "card",
        "card[number]": INR_TEST_CARD.number,
        "card[name]": INR_TEST_CARD.name,
        "card[expiry_month]": INR_TEST_CARD.expiry_month,
        "card[expiry_year]": INR_TEST_CARD.expiry_year,
        "card[cvv]": INR_TEST_CARD.cvv,
        key_id: this.opts.keyId,
      },
    });
    if (!form.ok) {
      throw new Error(`razorpay /v1/payments ${form.status}`);
    }
    const ref = paymentRef(form.json, form.text);
    await this.completeTestOtp(form.json, form.text);
    return ref;
  }

  private async completeTestOtp(payload: Record<string, unknown> | null, html: string): Promise<void> {
    const next = payload?.next;
    if (Array.isArray(next)) {
      for (const item of next) {
        if (item && typeof item === "object" && "action" in item && "url" in item) {
          const action = String((item as { action: unknown }).action);
          const url = String((item as { url: unknown }).url);
          if (action === "otp_generate" && url.startsWith("http")) {
            await this.request("POST", url);
          }
        }
      }
    }
    const submitUrl = otpSubmitUrl(payload, html);
    if (!submitUrl) return;
    await this.request("POST", submitUrl, { json: { otp: TEST_OTP } });
  }

  private async api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.request(method, path, body === undefined ? undefined : { json: body });
    if (!res.ok || !res.json) {
      throw new Error(`razorpay ${path} ${res.status}`);
    }
    return res.json;
  }

  private async request(
    method: string,
    pathOrUrl: string,
    opts?: { json?: unknown; form?: Record<string, string> },
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.opts.baseUrl}${pathOrUrl}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${basicAuth(this.opts.keyId, this.opts.keySecret)}`,
    };
    let body: string | undefined;
    if (opts?.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers.Origin = "https://api.razorpay.com";
      headers.Referer = "https://api.razorpay.com/";
      headers["User-Agent"] = "Mozilla/5.0";
      body = new URLSearchParams(opts.form).toString();
    } else if (opts?.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const res = await this.opts.fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body }) });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  }
}
