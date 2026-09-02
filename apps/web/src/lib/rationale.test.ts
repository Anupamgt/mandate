import { describe, expect, it } from "vitest";
import {
  activityFromAuditRow,
  activityFromSpendResult,
  displayRationale,
  mergeActivity,
} from "./rationale";

describe("FR-44 rationale display (informational)", () => {
  it("SEC-06 truncates at 256 and treats missing as empty", () => {
    expect(displayRationale(undefined)).toBe("");
    expect(displayRationale(null)).toBe("");
    expect(displayRationale("need GPU")).toBe("need GPU");
    expect(displayRationale("x".repeat(300))).toBe("x".repeat(256));
    expect(displayRationale("x".repeat(300)).length).toBe(256);
  });

  it("maps audit/spend payloads so the UI can show rationale", () => {
    const fromAudit = activityFromAuditRow({
      seq: 4,
      ts: "2026-09-02T12:00:00.000Z",
      spendRequestId: "sr-1",
      eventType: "DECISION",
      decision: "ALLOW",
      reasonCode: "ALLOW",
      rationale: `why ${"z".repeat(300)}`,
    });
    expect(fromAudit?.rationale).toBe(`why ${"z".repeat(300)}`.slice(0, 256));
    expect(fromAudit?.id).toBe("sr-1");
    expect(activityFromAuditRow({ eventType: "MANDATE_ISSUED" })).toBeNull();

    const fromSpend = activityFromSpendResult({
      spend_request_id: "sr-2",
      reason_code: "ALLOW",
      decision: "ALLOW",
      rationale: "operator-triggered demo spend",
      ts: "2026-09-02T12:00:01.000Z",
    });
    expect(fromSpend.rationale).toBe("operator-triggered demo spend");
    expect(fromSpend.source).toBe("local");
  });

  it("merges live rows without dropping rationale", () => {
    const merged = mergeActivity(
      [
        {
          id: "sr-1",
          ts: "2026-09-02T12:00:00.000Z",
          reason: "ALLOW",
          decision: "ALLOW",
          rationale: "",
          checks: [],
          source: "local",
        },
      ],
      [
        {
          id: "sr-1",
          ts: "2026-09-02T12:00:00.000Z",
          reason: "ALLOW",
          decision: "ALLOW",
          rationale: "from audit join",
          checks: [],
          source: "audit",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.rationale).toBe("from audit join");
  });
});
