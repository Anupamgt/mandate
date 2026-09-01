import type { EventType } from "@mandate/shared";

export type AuditAppend = {
  eventType: EventType;
  prevHash: string;
  hash: string;
};

/** Hash chain — implemented in T-008 (FR-60). */
export function verifyNotImplemented(): never {
  throw new Error("packages/audit verify() is T-008");
}
