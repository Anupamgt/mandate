import { describe, expect, it } from "vitest";
import { liveEventFromLocal, liveEventFromSse } from "./live-events";

describe("FR-71 live decision stream", () => {
  it("maps SSE decision, reasonCode, and checks onto LiveEvent", () => {
    const ev = liveEventFromSse({
      seq: 4,
      spendRequestId: "spend_1",
      ts: "2026-09-02T12:00:00.000Z",
      decision: "DENY",
      reasonCode: "PER_TXN_CAP_EXCEEDED",
      checks: ["signature:pass", "per_txn:exceeded"],
    });
    expect(ev).toEqual({
      id: "spend_1",
      ts: "2026-09-02T12:00:00.000Z",
      reason: "PER_TXN_CAP_EXCEEDED",
      decision: "DENY",
      checks: ["signature:pass", "per_txn:exceeded"],
      source: "stream",
    });
  });

  it("keeps checks from a local propose response", () => {
    const ev = liveEventFromLocal({
      spend_request_id: "spend_2",
      decision: "ALLOW",
      reason_code: "ALLOW",
      checks: ["signature:pass", "step_up:pass"],
    });
    expect(ev.checks).toEqual(["signature:pass", "step_up:pass"]);
    expect(ev.reason).toBe("ALLOW");
    expect(ev.source).toBe("local");
  });
});
