import { describe, expect, it } from "vitest";
import { computeAuditHash, GENESIS_HASH, verifyChain, type AuditRecord } from "./chain.js";

function row(seq: number, prevHash: string, extra: Partial<AuditRecord> = {}): AuditRecord {
  const base: Omit<AuditRecord, "hash"> = {
    seq,
    ts: `2026-09-01T00:00:0${seq}.000Z`,
    mandateId: "m1",
    spendRequestId: null,
    eventType: "MANDATE_ISSUED",
    actor: "operator",
    payloadHash: "aa",
    decision: null,
    reasonCode: null,
    prevHash,
    ...extra,
  };
  return { ...base, hash: computeAuditHash(base) };
}

describe("FR-60/FR-62 audit chain", () => {
  it("verifies a two-row chain", () => {
    const a = row(1, GENESIS_HASH);
    const b = row(2, a.hash ?? "");
    expect(verifyChain([a, b])).toEqual({ ok: true });
  });

  it("RT-10 reports the first break seq", () => {
    const a = row(1, GENESIS_HASH);
    const b = row(2, a.hash ?? "");
    const tampered = { ...b, actor: "attacker" };
    expect(verifyChain([a, tampered])).toEqual({ ok: false, first_break_seq: 2 });
  });
});
