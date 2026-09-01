export const REASON_CODES = [
  "ALLOW",
  "STEP_UP_THRESHOLD",
  "MANDATE_SIG_INVALID",
  "MANDATE_REVOKED",
  "MANDATE_EXPIRED",
  "WINDOW_NOT_STARTED",
  "WINDOW_EXPIRED",
  "AGENT_MISMATCH",
  "TOOL_NOT_ALLOWED",
  "TOOL_UNCLASSIFIED",
  "COUNTERPARTY_NOT_ALLOWED",
  "PER_TXN_CAP_EXCEEDED",
  "CUM_CAP_EXCEEDED",
  "NO_MANDATE",
  "RATE_LIMITED",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_CODE_SET: ReadonlySet<string> = new Set(REASON_CODES);

export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}

/** Compile-time exhaustiveness: add a code here when you add one to REASON_CODES. */
export function reasonCodeLabel(code: ReasonCode): string {
  switch (code) {
    case "ALLOW":
      return "allow";
    case "STEP_UP_THRESHOLD":
      return "step-up";
    case "MANDATE_SIG_INVALID":
      return "mandate signature invalid";
    case "MANDATE_REVOKED":
      return "mandate revoked";
    case "MANDATE_EXPIRED":
      return "mandate expired";
    case "WINDOW_NOT_STARTED":
      return "window not started";
    case "WINDOW_EXPIRED":
      return "window expired";
    case "AGENT_MISMATCH":
      return "agent mismatch";
    case "TOOL_NOT_ALLOWED":
      return "tool not allowed";
    case "TOOL_UNCLASSIFIED":
      return "tool unclassified";
    case "COUNTERPARTY_NOT_ALLOWED":
      return "counterparty not allowed";
    case "PER_TXN_CAP_EXCEEDED":
      return "per-txn cap exceeded";
    case "CUM_CAP_EXCEEDED":
      return "cumulative cap exceeded";
    case "NO_MANDATE":
      return "no mandate";
    case "RATE_LIMITED":
      return "rate limited";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
