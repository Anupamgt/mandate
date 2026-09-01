import type { Paise } from "@mandate/shared";

export type MandateBody = {
  max_per_txn_paise: Paise;
  max_total_paise: Paise;
  valid_from: string;
  valid_until: string;
  allowed_counterparties: readonly string[];
  allowed_tools: readonly string[];
  purpose: string;
  step_up_above_paise: Paise;
  agent_id: string;
};

/** Schema + Ed25519 — implemented in T-007 (FR-01/02). */
export function signNotImplemented(): never {
  throw new Error("packages/mandate sign() is T-007");
}
