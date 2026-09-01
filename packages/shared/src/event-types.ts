export const EVENT_TYPES = [
  "MANDATE_ISSUED",
  "MANDATE_REVOKED",
  "TERMS_RECEIVED",
  "SPEND_PROPOSED",
  "DECISION",
  "RESERVED",
  "SETTLED",
  "PROOF_VERIFIED",
  "PROVISIONED",
  "RECONCILED",
  "EXCEPTION",
  "EXCEPTION_UNRESOLVED",
  "TOOL_CALL_READ",
  "PROOF_REPLAY_REJECTED",
  "WEBHOOK_REJECTED",
  "APPROVAL_GRANTED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

export function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function eventTypeLabel(type: EventType): string {
  switch (type) {
    case "MANDATE_ISSUED":
      return "mandate issued";
    case "MANDATE_REVOKED":
      return "mandate revoked";
    case "TERMS_RECEIVED":
      return "terms received";
    case "SPEND_PROPOSED":
      return "spend proposed";
    case "DECISION":
      return "decision";
    case "RESERVED":
      return "reserved";
    case "SETTLED":
      return "settled";
    case "PROOF_VERIFIED":
      return "proof verified";
    case "PROVISIONED":
      return "provisioned";
    case "RECONCILED":
      return "reconciled";
    case "EXCEPTION":
      return "exception";
    case "EXCEPTION_UNRESOLVED":
      return "exception unresolved";
    case "TOOL_CALL_READ":
      return "tool call read";
    case "PROOF_REPLAY_REJECTED":
      return "proof replay rejected";
    case "WEBHOOK_REJECTED":
      return "webhook rejected";
    case "APPROVAL_GRANTED":
      return "approval granted";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
