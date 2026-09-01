import { createHash } from "node:crypto";
import { canonicalJson, isEventType, type EventType } from "@mandate/shared";

export const GENESIS_HASH = "0".repeat(64);

export type AuditRecord = {
  seq: number;
  ts: string;
  mandateId: string | null;
  spendRequestId: string | null;
  eventType: EventType;
  actor: string;
  payloadHash: string;
  decision: string | null;
  reasonCode: string | null;
  prevHash: string;
  hash?: string;
};

export function payloadDigest(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function computeAuditHash(row: Omit<AuditRecord, "hash">): string {
  if (!isEventType(row.eventType)) {
    throw new Error(`unknown event type: ${row.eventType}`);
  }
  const material = canonicalJson({
    actor: row.actor,
    decision: row.decision,
    eventType: row.eventType,
    mandateId: row.mandateId,
    payloadHash: row.payloadHash,
    prevHash: row.prevHash,
    reasonCode: row.reasonCode,
    seq: row.seq,
    spendRequestId: row.spendRequestId,
    ts: row.ts,
  });
  return createHash("sha256").update(row.prevHash + material, "utf8").digest("hex");
}

export type ChainBreak = { ok: true } | { ok: false; first_break_seq: number };

export function verifyChain(rows: readonly AuditRecord[]): ChainBreak {
  let prev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return { ok: false, first_break_seq: row.seq };
    }
    const expected = computeAuditHash({
      seq: row.seq,
      ts: row.ts,
      mandateId: row.mandateId,
      spendRequestId: row.spendRequestId,
      eventType: row.eventType,
      actor: row.actor,
      payloadHash: row.payloadHash,
      decision: row.decision,
      reasonCode: row.reasonCode,
      prevHash: row.prevHash,
    });
    if (row.hash !== expected) {
      return { ok: false, first_break_seq: row.seq };
    }
    prev = expected;
  }
  return { ok: true };
}
