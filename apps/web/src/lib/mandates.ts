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

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseMandate(raw: unknown): Mandate | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const bodyRaw = rec.body;
  const body =
    bodyRaw !== null && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
  const id = asText(rec.id);
  const remaining = asInt(rec.remaining_paise);
  const maxTotal = asInt(body.max_total_paise);
  const maxPer = asInt(body.max_per_txn_paise);
  if (!id || remaining === null || maxTotal === null || maxPer === null) {
    return null;
  }
  return {
    id,
    status: asText(rec.status) ?? "UNKNOWN",
    agent_id: asText(rec.agent_id) ?? "",
    remaining_paise: remaining,
    body: {
      max_total_paise: maxTotal,
      max_per_txn_paise: maxPer,
      purpose: asText(body.purpose) ?? "",
      step_up_above_paise: asInt(body.step_up_above_paise) ?? undefined,
    },
  };
}

/** List ids from GET /mandates, remaining_paise from GET /mandates/:id (not evaluate()). */
export async function loadMandateRows(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Mandate[]> {
  let listed: unknown[] = [];
  try {
    const res = await fetchImpl(`${baseUrl}/mandates`, { cache: "no-store" });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as { mandates?: unknown[] };
    listed = json.mandates ?? [];
  } catch {
    return [];
  }
  const rows: Mandate[] = [];
  for (const item of listed) {
    const id = item !== null && typeof item === "object" ? asText((item as { id?: unknown }).id) : null;
    if (!id) {
      continue;
    }
    try {
      const detailRes = await fetchImpl(`${baseUrl}/mandates/${id}`, { cache: "no-store" });
      if (detailRes.ok) {
        const parsed = parseMandate(await detailRes.json());
        if (parsed) {
          rows.push(parsed);
          continue;
        }
      }
    } catch {
      // fall through to collection row
    }
    const fallback = parseMandate(item);
    if (fallback) {
      rows.push(fallback);
    }
  }
  return rows;
}
