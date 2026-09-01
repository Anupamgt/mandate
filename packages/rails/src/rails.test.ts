import { describe, expect, it } from "vitest";
import { asPaise } from "@mandate/shared";
import { MockRail } from "./mock.js";
import { RazorpayTestRail } from "./razorpay.js";

describe("FR-30/FR-32/FR-33 rails", () => {
  it("MockRail is idempotent on invoice_id", async () => {
    const rail = new MockRail();
    const quote = await rail.quote(asPaise(100), "prov_a");
    const a = await rail.pay(quote, "m1", "inv_1");
    const b = await rail.pay(quote, "m1", "inv_1");
    expect(a.externalRef).toBe(b.externalRef);
  });

  it("MockRail can inject reverse failure (FR-51)", async () => {
    const rail = new MockRail({ reverseFails: true });
    const quote = await rail.quote(asPaise(100), "prov_a");
    const paid = await rail.pay(quote, "m1", "inv_2");
    const rev = await rail.reverse(paid, "timeout");
    expect(rev.succeeded).toBe(false);
  });

  it("RazorpayTestRail uses injected fetch (no network)", async () => {
    const calls: string[] = [];
    const rail = new RazorpayTestRail({
      keyId: "rzp_test_abc",
      keySecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        if (String(url).includes("/orders") && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "order_1" }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "pay_1" }), { status: 200 });
      },
    });
    const quote = await rail.quote(asPaise(500), "prov_a");
    const paid = await rail.pay(quote, "m1", "inv_live");
    expect(paid.externalRef).toBe("pay_1");
    expect(calls[0]).toContain("/v1/orders");
  });

  it("refuses live keys", () => {
    expect(
      () => new RazorpayTestRail({ keyId: "rzp_live_nope", keySecret: "x" }),
    ).toThrow(/forbidden/);
  });
});
