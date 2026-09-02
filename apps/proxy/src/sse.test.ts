import { describe, expect, it } from "vitest";
import { decisionSsePayload, parseChecksJson } from "./sse.js";

describe("FR-71 SSE decision payload", () => {
  it("includes decision, reasonCode, and checks from Decision.checksJson", () => {
    const checks = parseChecksJson(
      JSON.stringify(["signature:pass", "status:pass", "window:pass", "per_txn:exceeded"]),
    );
    expect(
      decisionSsePayload(
        {
          seq: 4,
          ts: new Date("2026-09-02T12:00:00.000Z"),
          spendRequestId: "spend_1",
          decision: "DENY",
          reasonCode: "PER_TXN_CAP_EXCEEDED",
        },
        checks,
      ),
    ).toEqual({
      seq: 4,
      ts: "2026-09-02T12:00:00.000Z",
      spendRequestId: "spend_1",
      decision: "DENY",
      reasonCode: "PER_TXN_CAP_EXCEEDED",
      checks: ["signature:pass", "status:pass", "window:pass", "per_txn:exceeded"],
      rationale: "",
    });
  });

  it("returns empty checks when checksJson is missing or not a string array", () => {
    expect(parseChecksJson(undefined)).toEqual([]);
    expect(parseChecksJson(null)).toEqual([]);
    expect(parseChecksJson("not-json")).toEqual([]);
    expect(parseChecksJson("{\"x\":1}")).toEqual([]);
    expect(parseChecksJson("[1,\"ok\"]")).toEqual(["ok"]);
  });
});
