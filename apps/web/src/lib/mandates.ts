import { budgetPercent, usedBudgetPaise, usedBudgetPercent } from "./format";

export type Mandate = {
  id: string;
  status: string;
  agent_id: string;
  remaining_paise: number;
  body: { max_total_paise: number; max_per_txn_paise: number; purpose: string; step_up_above_paise?: number };
};

export type MandateListRow = Mandate & {
  used_paise: number;
  used_percent: number;
  remaining_percent: number;
  can_revoke: boolean;
};

/** FR-70: every GET /mandates row, with remaining-budget bar fields. */
export function toMandateList(mandates: Mandate[]): MandateListRow[] {
  return mandates.map((m) => ({
    ...m,
    used_paise: usedBudgetPaise(m.remaining_paise, m.body.max_total_paise),
    used_percent: usedBudgetPercent(m.remaining_paise, m.body.max_total_paise),
    remaining_percent: budgetPercent(m.remaining_paise, m.body.max_total_paise),
    can_revoke: m.status === "ACTIVE",
  }));
}

export function revokeRequestBody(mandateId: string, reason: string, revokedAt: string) {
  return {
    mandate_id: mandateId,
    reason,
    revoked_at: revokedAt,
  };
}
