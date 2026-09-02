import { describe, expect, it } from "vitest";
import {
  exceptionExplainPath,
  loadExceptions,
  parseExceptionRow,
  parseExplainResponse,
} from "./exceptions";

const sample = {
  seq: 12,
  ts: "2026-09-02T12:00:00.000Z",
  eventType: "EXCEPTION",
  actor: "reconciler",
  decision: null,
  reasonCode: null,
  spendRequestId: "spend-1",
  mandateId: "m-1",
  payloadHash: "aa",
  prevHash: "bb",
  hash: "cc",
};

describe("FR-72 exceptions list + Explain", () => {
  it("parses GET /exceptions rows using audit seq as the list identity", () => {
    const row = parseExceptionRow(sample);
    expect(row?.seq).toBe(12);
    expect(row?.spendRequestId).toBe("spend-1");
    expect(row?.eventType).toBe("EXCEPTION");
    expect(exceptionExplainPath(row!)).toBe("/exceptions/12/explain");
  });

  it("loads every exception from GET /exceptions", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toBe("http://127.0.0.1:18787/exceptions");
      return new Response(
        JSON.stringify({
          exceptions: [sample, { ...sample, seq: 8, spendRequestId: "spend-0", eventType: "EXCEPTION_UNRESOLVED" }],
        }),
      );
    };
    const rows = await loadExceptions("http://127.0.0.1:18787", fetchImpl);
    expect(rows.map((r) => r.seq)).toEqual([12, 8]);
    expect(rows[1]?.eventType).toBe("EXCEPTION_UNRESOLVED");
  });

  it("keeps audit rows on the Explain response as the source of truth", () => {
    const parsed = parseExplainResponse({
      spend_request_id: "spend-1",
      exception_seq: 12,
      narrative: "At seq 4 DECISION ALLOW. At seq 12 EXCEPTION.",
      source: "heuristic",
      rows: [
        { ...sample, seq: 4, eventType: "DECISION", decision: "ALLOW", reasonCode: "ALLOW" },
        sample,
      ],
    });
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows.map((r) => r.seq)).toEqual([4, 12]);
    expect(parsed?.narrative).toContain("seq 12");
    expect(parsed?.source).toBe("heuristic");
  });

  it("returns an empty list when GET /exceptions fails", async () => {
    const rows = await loadExceptions("http://127.0.0.1:18787", async () => {
      throw new Error("offline");
    });
    expect(rows).toEqual([]);
  });
});
