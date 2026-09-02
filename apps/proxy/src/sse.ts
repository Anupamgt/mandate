/** Public SSE payload for FR-71. No secrets, no audit hashes. */

export type DecisionSsePayload = {
  seq: number;
  ts: string;
  spendRequestId: string | null;
  decision: string | null;
  reasonCode: string | null;
  checks: string[];
};

export function parseChecksJson(raw: string | null | undefined): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function decisionSsePayload(
  row: {
    seq: number;
    ts: Date | string;
    spendRequestId: string | null;
    decision: string | null;
    reasonCode: string | null;
  },
  checks: readonly string[],
): DecisionSsePayload {
  return {
    seq: row.seq,
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
    spendRequestId: row.spendRequestId,
    decision: row.decision,
    reasonCode: row.reasonCode,
    checks: [...checks],
  };
}
