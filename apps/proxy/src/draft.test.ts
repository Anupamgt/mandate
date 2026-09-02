import { describe, expect, it } from "vitest";
import { makeTestProxy } from "./harness.js";

describe("POST /mandates/draft FR-05", () => {
  it('returns schema-constrained caps and empty-allowlist warning for "no limit, pay anyone"', async () => {
    const { app } = await makeTestProxy();
    const res = await app.request("/mandates/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "no limit, pay anyone" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      body: {
        max_per_txn_paise: number;
        max_total_paise: number;
        allowed_counterparties: string[];
        step_up_above_paise: number;
      };
      warnings: string[];
      readback: string;
      signature?: string;
    };
    expect(json.signature).toBeUndefined();
    expect(Object.keys(json)).not.toContain("signature");
    expect(json.body.max_per_txn_paise).toBeGreaterThan(0);
    expect(json.body.max_total_paise).toBeGreaterThan(0);
    expect(json.body.max_per_txn_paise).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(json.body.allowed_counterparties).toEqual([]);
    expect(json.warnings).toContain("empty_allowlist");
    expect(json.warnings).toContain("missing_caps");
    expect(json.readback.toLowerCase()).toMatch(/none|empty|no counterpart/);
  });

  it("truncates intent to 256 chars and never signs", async () => {
    const { app } = await makeTestProxy();
    const intent = "x".repeat(400);
    const res = await app.request("/mandates/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    const json = (await res.json()) as { intent: string; signature?: unknown };
    expect(json.intent).toHaveLength(256);
    expect(json.signature).toBeUndefined();
  });
});
