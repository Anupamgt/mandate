import { describe, expect, it } from "vitest";
import { parseDenialText, parseToolDenial, SMOKE_CAPS, SMOKE_TOOL } from "./smoke-support.js";

describe("T-032 MCP denial shape", () => {
  it("parses PER_TXN_CAP_EXCEEDED structured denial from tool text", () => {
    const text = JSON.stringify({
      kind: "deny",
      decision: "DENY",
      reason_code: "PER_TXN_CAP_EXCEEDED",
      checks: ["signature:pass", "per_txn:exceeded"],
    });
    expect(parseDenialText(text)).toEqual({
      decision: "DENY",
      reason_code: "PER_TXN_CAP_EXCEEDED",
      checks: ["signature:pass", "per_txn:exceeded"],
    });
  });

  it("parses CUM_CAP_EXCEEDED from an MCP tools/call result", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            decision: "DENY",
            reason_code: "CUM_CAP_EXCEEDED",
            checks: ["cumulative:exceeded"],
          }),
        },
      ],
    };
    expect(parseToolDenial(result).reason_code).toBe("CUM_CAP_EXCEEDED");
  });

  it("uses update_refund (MONEY_OUT) with known caps", () => {
    expect(SMOKE_TOOL).toBe("update_refund");
    expect(SMOKE_CAPS.per_txn_over).toBeGreaterThan(SMOKE_CAPS.max_per_txn_paise);
    expect(SMOKE_CAPS.cum_over).toBeGreaterThan(SMOKE_CAPS.max_total_paise);
    expect(SMOKE_CAPS.cum_over).toBeLessThanOrEqual(SMOKE_CAPS.max_per_txn_paise);
  });
});
