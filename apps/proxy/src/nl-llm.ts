import {
  draftMandateFromIntent,
  normalizeMandateDraft,
  readbackMandate,
  truncateIntent,
  type MandateDraft,
} from "@mandate/mandate";

const DRAFT_SYSTEM = [
  "Return JSON for a MandateBody draft only. Fields: agent_id, principal_id,",
  "max_per_txn_paise, max_total_paise, valid_from, valid_until,",
  "allowed_counterparties, allowed_tools, purpose, step_up_above_paise.",
  "Amounts are integer paise. Never omit caps. Never use null, unlimited, or max-int.",
  "If the operator asks for no limit or pay anyone, still emit explicit numeric caps",
  "and an empty allowed_counterparties array. Do not sign.",
].join(" ");

type LlmJson = Record<string, unknown>;

async function parseJsonObject(text: string): Promise<LlmJson | null> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as LlmJson;
    }
  } catch {
    /* fall through to heuristic */
  }
  return null;
}

async function tryOpenAiDraft(intent: string, apiKey: string): Promise<LlmJson | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: intent },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseJsonObject(content);
}

async function tryAnthropicDraft(intent: string, apiKey: string): Promise<LlmJson | null> {
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
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: intent }],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: { type?: string; text?: string }[] };
  const text = json.content?.find((part) => part.type === "text")?.text;
  if (!text) return null;
  const fenced = text.match(/\{[\s\S]*\}/);
  return parseJsonObject(fenced?.[0] ?? text);
}

async function tryLlmDraft(intent: string): Promise<LlmJson | null> {
  // Unit tests must stay offline. Deterministic adapter covers FR-05 without a key.
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return null;
  }
  const openai = process.env.OPENAI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (!openai && !anthropic) return null;
  try {
    if (openai) return await tryOpenAiDraft(intent, openai);
    if (anthropic) return await tryAnthropicDraft(intent, anthropic);
  } catch {
    return null;
  }
  return null;
}

export type MandateDraftResponse = MandateDraft & { readback: string };

export async function buildMandateDraft(intentRaw: unknown, now: Date): Promise<MandateDraftResponse> {
  const intent = truncateIntent(String(intentRaw ?? ""));
  const llm = await tryLlmDraft(intent);
  const draft = llm ? normalizeMandateDraft(llm, intent, now) : draftMandateFromIntent(intent, now);
  return { ...draft, readback: readbackMandate(draft.body) };
}
