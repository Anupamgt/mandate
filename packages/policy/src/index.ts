import type { ReasonCode } from "@mandate/shared";

export type PolicyResult = {
  decision: "ALLOW" | "DENY" | "STEP_UP";
  reason_code: ReasonCode;
  checks: readonly string[];
};

/** Pure evaluate() — implemented in T-006 (FR-10). */
export function evaluateNotImplemented(): never {
  throw new Error("packages/policy evaluate() is T-006");
}
