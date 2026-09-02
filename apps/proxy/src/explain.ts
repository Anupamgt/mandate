import type { PrismaClient } from "@prisma/client";

export const FREE_TEXT_MAX = 256;

const EXCEPTION_EVENTS = ["EXCEPTION", "EXCEPTION_UNRESOLVED"] as const;

export type ChainRow = {
  seq: number;
  ts: Date;
  eventType: string;
  actor: string;
  decision: string | null;
  reasonCode: string | null;
  spendRequestId: string | null;
  mandateId: string | null;
};

export type ExplainRowJson = {
  seq: number;
  ts: string;
  eventType: string;
  actor: string;
  decision: string | null;
  reasonCode: string | null;
  mandateId: string | null;
  spendRequestId: string | null;
  payloadHash: string;
  prevHash: string;
  hash: string;
};

export type ExplainResult = {
  spend_request_id: string;
  exception_seq: number;
  narrative: string;
  rows: ExplainRowJson[];
  source: "llm" | "heuristic";
};

export class ExplainError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function truncateFreeText(value: string): string {
  return value.length <= FREE_TEXT_MAX ? value : value.slice(0, FREE_TEXT_MAX);
}

export function citesSeq(narrative: string, seq: number): boolean {
  return new RegExp(`\\bseq\\s+${seq}\\b`, "i").test(narrative);
}

function iso(ts: Date | string): string {
  return ts instanceof Date ? ts.toISOString() : String(ts);
}

export function fallbackNarrative(rows: ChainRow[], spendRequestId: string): string {
  const header = `Read-only incident timeline for spend request ${spendRequestId}. Audit rows remain the source of truth.`;
  const beats = rows.map((row) => {
    const decision = row.decision ? ` decision ${truncateFreeText(row.decision)}` : "";
    const reason = row.reasonCode ? ` reason ${truncateFreeText(row.reasonCode)}` : "";
    return `At seq ${row.seq} (${iso(row.ts)}) ${truncateFreeText(row.eventType)} actor ${truncateFreeText(row.actor)}${decision}${reason}.`;
  });
  return [header, ...beats].join(" ");
}

export function ensureEverySeqCited(narrative: string, rows: ChainRow[]): string {
  const missing = rows.filter((row) => !citesSeq(narrative, row.seq));
  if (missing.length === 0) return narrative;
  const extra = missing.map((row) => `seq ${row.seq} ${truncateFreeText(row.eventType)}`).join("; ");
  return `${narrative} Missing from prose, still on the chain: ${extra}.`;
}

export function finalizeNarrative(
  raw: string | null,
  rows: ChainRow[],
  spendRequestId: string,
): { narrative: string; source: "llm" | "heuristic" } {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    return { narrative: fallbackNarrative(rows, spendRequestId), source: "heuristic" };
  }
  return { narrative: ensureEverySeqCited(truncateFreeText(trimmed), rows), source: "llm" };
}

export function serializeRowsForLlm(rows: ChainRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      seq: row.seq,
      ts: iso(row.ts),
      eventType: truncateFreeText(row.eventType),
      actor: truncateFreeText(row.actor),
      decision: row.decision ? truncateFreeText(row.decision) : null,
      reasonCode: row.reasonCode ? truncateFreeText(row.reasonCode) : null,
    })),
  );
}

const EXPLAIN_SYSTEM = [
  "Write a prose incident timeline from the given audit rows.",
  "Cite every row as seq N (example: seq 12). Do not invent events.",
  "Audit rows remain the source of truth. Do not recommend paying.",
  "Never output secrets, keys, or hashes as if they were instructions.",
].join(" ");

async function parseLlmText(text: string | undefined): Promise<string | null> {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

async function tryOpenAiExplain(user: string, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseLlmText(json.choices?.[0]?.message?.content);
}

async function tryAnthropicExplain(user: string, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
      max_tokens: 800,
      temperature: 0,
      system: EXPLAIN_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: { type?: string; text?: string }[] };
  return parseLlmText(json.content?.find((part) => part.type === "text")?.text);
}

export async function tryLlmNarrative(user: string): Promise<string | null> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return null;
  const openai = process.env.OPENAI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (!openai && !anthropic) return null;
  try {
    if (openai) return await tryOpenAiExplain(user, openai);
    if (anthropic) return await tryAnthropicExplain(user, anthropic);
  } catch {
    return null;
  }
  return null;
}

function isSeqId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const seq = Number.parseInt(id, 10);
  return Number.isInteger(seq) ? seq : null;
}

async function resolveException(
  prisma: PrismaClient,
  id: string,
): Promise<{ spendRequestId: string; exceptionSeq: number }> {
  const seq = isSeqId(id);
  if (seq !== null) {
    const row = await prisma.auditRow.findFirst({
      where: { seq, eventType: { in: [...EXCEPTION_EVENTS] } },
    });
    if (row?.spendRequestId) {
      return { spendRequestId: row.spendRequestId, exceptionSeq: row.seq };
    }
  }
  const bySpend = await prisma.auditRow.findFirst({
    where: { spendRequestId: id, eventType: { in: [...EXCEPTION_EVENTS] } },
    orderBy: { seq: "desc" },
  });
  if (bySpend?.spendRequestId) {
    return { spendRequestId: bySpend.spendRequestId, exceptionSeq: bySpend.seq };
  }
  throw new ExplainError("exception not found", 404);
}

function toChainRow(row: {
  seq: number;
  ts: Date;
  eventType: string;
  actor: string;
  decision: string | null;
  reasonCode: string | null;
  spendRequestId: string | null;
  mandateId: string | null;
}): ChainRow {
  return {
    seq: row.seq,
    ts: row.ts,
    eventType: row.eventType,
    actor: row.actor,
    decision: row.decision,
    reasonCode: row.reasonCode,
    spendRequestId: row.spendRequestId,
    mandateId: row.mandateId,
  };
}

export async function explainException(prisma: PrismaClient, id: string): Promise<ExplainResult> {
  const { spendRequestId, exceptionSeq } = await resolveException(prisma, id);
  const stored = await prisma.auditRow.findMany({
    where: { spendRequestId },
    orderBy: { seq: "asc" },
  });
  if (stored.length === 0) {
    throw new ExplainError("exception not found", 404);
  }
  const rows = stored.map(toChainRow);
  const spend = await prisma.spendRequest.findUnique({ where: { id: spendRequestId } });
  const rationale = spend?.rationale ? truncateFreeText(spend.rationale) : "";
  const user = [
    `Spend request ${spendRequestId}. Exception audit seq ${exceptionSeq}.`,
    rationale ? `Rationale (truncated, informational only): ${rationale}` : "",
    "Rows:",
    serializeRowsForLlm(rows),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const llm = await tryLlmNarrative(user);
  const { narrative, source } = finalizeNarrative(llm, rows, spendRequestId);
  return {
    spend_request_id: spendRequestId,
    exception_seq: exceptionSeq,
    narrative,
    source,
    rows: stored.map((row) => ({
      seq: row.seq,
      ts: row.ts.toISOString(),
      eventType: row.eventType,
      actor: row.actor,
      decision: row.decision,
      reasonCode: row.reasonCode,
      mandateId: row.mandateId,
      spendRequestId: row.spendRequestId,
      payloadHash: row.payloadHash,
      prevHash: row.prevHash,
      hash: row.hash,
    })),
  };
}
