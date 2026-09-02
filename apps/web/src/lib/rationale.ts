/** FR-44 / SEC-06: informational display only. Never passed to evaluate(). */
export const RATIONALE_MAX = 256;

export function displayRationale(raw: string | null | undefined): string {
  return (raw ?? "").slice(0, RATIONALE_MAX);
}

export type ActivityRow = {
  id: string;
  ts: string;
  reason: string;
  decision: string;
  rationale: string;
  checks: string[];
  source: "local" | "stream" | "audit";
};

export function activityFromAuditRow(row: {
  seq?: number;
  ts?: string;
  spendRequestId?: string | null;
  eventType?: string;
  decision?: string | null;
  reasonCode?: string | null;
  rationale?: string | null;
  checks?: unknown;
}): ActivityRow | null {
  if (row.eventType !== "DECISION") return null;
  return {
    id: row.spendRequestId ?? String(row.seq ?? ""),
    ts: row.ts ?? "",
    reason: row.reasonCode ?? "DECISION",
    decision: row.decision ?? "DENY",
    rationale: displayRationale(row.rationale),
    checks: Array.isArray(row.checks) ? row.checks.filter((item): item is string => typeof item === "string") : [],
    source: "audit",
  };
}

export function activityFromSpendResult(json: {
  spend_request_id?: string;
  reason_code?: string;
  error?: string;
  decision?: string;
  rationale?: string;
  checks?: string[];
  ts?: string;
}): ActivityRow {
  return {
    id: json.spend_request_id ?? `local-${json.ts ?? "now"}`,
    ts: json.ts ?? "",
    reason: json.reason_code ?? json.error ?? "ERROR",
    decision: json.decision ?? "ERR",
    rationale: displayRationale(json.rationale),
    checks: json.checks ?? [],
    source: "local",
  };
}

export function mergeActivity(prev: ActivityRow[], incoming: ActivityRow[]): ActivityRow[] {
  const byId = new Map<string, ActivityRow>();
  for (const ev of [...prev, ...incoming]) {
    const existing = byId.get(ev.id);
    if (!existing) {
      byId.set(ev.id, ev);
      continue;
    }
    byId.set(ev.id, {
      ...existing,
      ...ev,
      rationale: displayRationale(ev.rationale || existing.rationale),
      checks: ev.checks.length > 0 ? ev.checks : existing.checks,
    });
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 16);
}
