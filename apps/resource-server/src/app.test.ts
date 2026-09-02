import { describe, expect, it } from "vitest";
import { createResourceApp } from "./app.js";

describe("FR-40 402 terms", () => {
  it("unpaid compute/run returns typed 402", async () => {
    const app = createResourceApp({
      proxyBaseUrl: "http://proxy.test",
      webhookSecret: "s",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    const res = await app.request("/compute/run", { method: "POST" });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { terms: { amount_paise: number; note: string } };
    expect(Number.isInteger(body.terms.amount_paise)).toBe(true);
    expect(body.terms.note.length).toBeLessThanOrEqual(256);
  });
});
