export type LiveEvent = {
  id: string;
  ts: string;
  reason: string;
  decision: string;
  checks: string[];
  source: "local" | "stream";
};

export type DecisionSseRow = {
  seq?: number;
  reasonCode?: string;
  decision?: string;
  ts?: string;
  spendRequestId?: string;
  checks?: unknown;
};

export function checksList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Map a GET /events `decision` frame to the dashboard LiveEvent. */
export function liveEventFromSse(row: DecisionSseRow): LiveEvent {
  return {
    id: row.spendRequestId ?? String(row.seq ?? "sse"),
    ts: row.ts ?? new Date().toISOString(),
    reason: row.reasonCode ?? "DECISION",
    decision: row.decision ?? "DENY",
    checks: checksList(row.checks),
    source: "stream",
  };
}

export function liveEventFromLocal(input: {
  spend_request_id?: string;
  decision?: string;
  reason_code?: string;
  error?: string;
  checks?: string[];
}): LiveEvent {
  return {
    id: input.spend_request_id ?? "local",
    ts: new Date().toISOString(),
    reason: input.reason_code ?? input.error ?? "ERROR",
    decision: input.decision ?? "ERR",
    checks: input.checks ?? [],
    source: "local",
  };
}
