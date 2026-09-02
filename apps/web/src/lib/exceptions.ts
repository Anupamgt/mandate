export type ExceptionRow = {
  seq: number;
  ts: string;
  eventType: string;
  actor: string;
  decision: string | null;
  reasonCode: string | null;
  spendRequestId: string | null;
  mandateId: string | null;
  payloadHash: string;
  prevHash: string;
  hash: string;
};

export type ExplainResponse = {
  spend_request_id: string;
  exception_seq: number;
  narrative: string;
  rows: ExceptionRow[];
  source: "llm" | "heuristic";
};

function asSeq(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

/** GET /exceptions row identity is audit seq (matches POST /exceptions/:id/explain). */
export function exceptionExplainPath(row: Pick<ExceptionRow, "seq">): string {
  return `/exceptions/${row.seq}/explain`;
}

export function parseExceptionRow(raw: unknown): ExceptionRow | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const seq = asSeq(rec.seq);
  const eventType = asText(rec.eventType) ?? asText(rec.event_type);
  if (seq === null || !eventType) return null;
  return {
    seq,
    ts: asText(rec.ts) ?? "",
    eventType,
    actor: asText(rec.actor) ?? "",
    decision: asOptionalText(rec.decision),
    reasonCode: asOptionalText(rec.reasonCode) ?? asOptionalText(rec.reason_code),
    spendRequestId: asOptionalText(rec.spendRequestId) ?? asOptionalText(rec.spend_request_id),
    mandateId: asOptionalText(rec.mandateId) ?? asOptionalText(rec.mandate_id),
    payloadHash: asText(rec.payloadHash) ?? asText(rec.payload_hash) ?? "",
    prevHash: asText(rec.prevHash) ?? asText(rec.prev_hash) ?? "",
    hash: asText(rec.hash) ?? "",
  };
}

export function parseExplainResponse(raw: unknown): ExplainResponse | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const spend = asText(rec.spend_request_id);
  const exceptionSeq = asSeq(rec.exception_seq);
  const narrative = asText(rec.narrative);
  const source = rec.source === "llm" || rec.source === "heuristic" ? rec.source : null;
  if (!spend || exceptionSeq === null || !narrative || !source) return null;
  const rowsRaw = Array.isArray(rec.rows) ? rec.rows : [];
  const rows = rowsRaw.map(parseExceptionRow).filter((row): row is ExceptionRow => row !== null);
  return {
    spend_request_id: spend,
    exception_seq: exceptionSeq,
    narrative,
    rows,
    source,
  };
}

export async function loadExceptions(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExceptionRow[]> {
  try {
    const res = await fetchImpl(`${baseUrl}/exceptions`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { exceptions?: unknown[] };
    return (json.exceptions ?? []).map(parseExceptionRow).filter((row): row is ExceptionRow => row !== null);
  } catch {
    return [];
  }
}

export async function requestExplain(
  baseUrl: string,
  seq: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplainResponse | { error: string }> {
  try {
    const res = await fetchImpl(`${baseUrl}${exceptionExplainPath({ seq })}`, {
      method: "POST",
      cache: "no-store",
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const err = json !== null && typeof json === "object" ? (json as { error?: unknown }).error : null;
      return { error: typeof err === "string" ? err : `HTTP ${res.status}` };
    }
    const parsed = parseExplainResponse(json);
    return parsed ?? { error: "malformed explain response" };
  } catch (e) {
    return { error: String(e) };
  }
}
