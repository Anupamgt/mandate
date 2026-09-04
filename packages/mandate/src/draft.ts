import { parseMandateBody, type MandateBody } from "./schema.js";

export const INTENT_MAX_CHARS = 256;

export const DEFAULT_DRAFT_CAPS = {
  max_per_txn_paise: 10_000,
  max_total_paise: 50_000,
  step_up_above_paise: 8_000,
} as const;

export type DraftWarning = "empty_allowlist" | "missing_caps";

export type MandateDraft = {
  body: MandateBody;
  warnings: DraftWarning[];
  intent: string;
};

const OPEN_PAY = /\bpay\s+(anyone|anybody|everyone|everybody)\b|\bany\s+counterparty\b/i;
const UNLIMITED = /\bno\s+limit\b|\bunlimited\b|\bno\s+cap\b|\binfinite\b/i;
const COUNTERPARTY_ID = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi;
const KNOWN_TOOLS = ["create_order", "create_payment_link", "create_payout"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function truncateIntent(intent: string): string {
  return intent.slice(0, INTENT_MAX_CHARS);
}

export function isUnlimitedIntent(intent: string): boolean {
  return UNLIMITED.test(intent);
}

function usableCap(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
}

function rupeesToPaise(rupees: number): number {
  return rupees * 100;
}

function inr(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const remainder = paise % 100;
  return `₹${rupees}.${String(remainder).padStart(2, "0")}`;
}

function stringField(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function stringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function extractNamedCounterparties(intent: string): string[] {
  if (OPEN_PAY.test(intent)) return [];
  const found = intent.match(COUNTERPARTY_ID) ?? [];
  return [...new Set(found.map((id) => id.toLowerCase()))];
}

function extractTools(intent: string): string[] {
  const lower = intent.toLowerCase();
  const found = KNOWN_TOOLS.filter((tool) => lower.includes(tool));
  return found.length > 0 ? found : ["create_order", "create_payment_link"];
}

function extractExplicitCaps(intent: string): { per?: number; total?: number } {
  const perTxn = intent.match(/₹\s*(\d+)\s*per\s*txn/i);
  const total = intent.match(/₹\s*(\d+)\s*total/i);
  const out: { per?: number; total?: number } = {};
  if (perTxn?.[1]) {
    const perRupees = Number(perTxn[1]);
    if (Number.isInteger(perRupees)) {
      out.per = rupeesToPaise(perRupees);
    }
  }
  if (total?.[1]) {
    const totalRupees = Number(total[1]);
    if (Number.isInteger(totalRupees)) {
      out.total = rupeesToPaise(totalRupees);
    }
  }
  return out;
}

function heuristicPartial(intent: string, now: Date): Record<string, unknown> {
  const caps = extractExplicitCaps(intent);
  return {
    agent_id: "agent_demo",
    principal_id: "operator",
    max_per_txn_paise: caps.per,
    max_total_paise: caps.total,
    valid_from: now.toISOString(),
    valid_until: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(),
    allowed_counterparties: extractNamedCounterparties(intent),
    allowed_tools: extractTools(intent),
    purpose: intent.trim().length > 0 ? intent.trim() : "unspecified",
    step_up_above_paise: DEFAULT_DRAFT_CAPS.step_up_above_paise,
  };
}

export function normalizeMandateDraft(
  partial: unknown,
  intent: string,
  now: Date = new Date(),
): MandateDraft {
  const truncated = truncateIntent(intent);
  const rec = asRecord(partial);
  const unlimited = isUnlimitedIntent(truncated);
  const per = !unlimited && usableCap(rec.max_per_txn_paise) ? rec.max_per_txn_paise : DEFAULT_DRAFT_CAPS.max_per_txn_paise;
  const total = !unlimited && usableCap(rec.max_total_paise) ? rec.max_total_paise : DEFAULT_DRAFT_CAPS.max_total_paise;
  const step =
    usableCap(rec.step_up_above_paise) && !unlimited
      ? rec.step_up_above_paise
      : DEFAULT_DRAFT_CAPS.step_up_above_paise;
  const missingCaps = unlimited || !usableCap(rec.max_per_txn_paise) || !usableCap(rec.max_total_paise);
  const counterparties = OPEN_PAY.test(truncated)
    ? []
    : stringList(rec.allowed_counterparties, []);

  const body = parseMandateBody({
    agent_id: stringField(rec.agent_id, "agent_demo"),
    principal_id: stringField(rec.principal_id, "operator"),
    max_per_txn_paise: per,
    max_total_paise: total,
    valid_from: stringField(rec.valid_from, now.toISOString()),
    valid_until: stringField(
      rec.valid_until,
      new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(),
    ),
    allowed_counterparties: counterparties,
    allowed_tools: stringList(rec.allowed_tools, ["create_order", "create_payment_link"]),
    purpose: stringField(rec.purpose, truncated.trim() || "unspecified"),
    step_up_above_paise: step,
  });

  const warnings: DraftWarning[] = [];
  if (body.allowed_counterparties.length === 0) warnings.push("empty_allowlist");
  if (missingCaps) warnings.push("missing_caps");

  return { body, warnings, intent: truncated };
}

export function draftMandateFromIntent(intent: string, now: Date = new Date()): MandateDraft {
  const truncated = truncateIntent(intent);
  return normalizeMandateDraft(heuristicPartial(truncated, now), truncated, now);
}

export function remainingDraftWarnings(
  body: {
    max_per_txn_paise: number;
    max_total_paise: number;
    allowed_counterparties: readonly string[];
  },
  seed: readonly DraftWarning[],
  opts: { original: { max_per_txn_paise: number; max_total_paise: number }; capsTouched?: boolean },
): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  if (body.allowed_counterparties.length === 0) warnings.push("empty_allowlist");
  const capsUntouched =
    opts.capsTouched === true
      ? false
      : body.max_per_txn_paise === opts.original.max_per_txn_paise &&
        body.max_total_paise === opts.original.max_total_paise;
  if (seed.includes("missing_caps") && capsUntouched) warnings.push("missing_caps");
  return warnings;
}

export function canSignMandateDraft(
  body: {
    max_per_txn_paise: number;
    max_total_paise: number;
    allowed_counterparties: readonly string[];
  },
  seed: readonly DraftWarning[],
  opts: { original: { max_per_txn_paise: number; max_total_paise: number }; capsTouched?: boolean },
): boolean {
  return remainingDraftWarnings(body, seed, opts).length === 0;
}

export function readbackMandate(body: MandateBody): string {
  const counterparties =
    body.allowed_counterparties.length === 0
      ? "none (empty allowlist — fill before signing)"
      : body.allowed_counterparties.join(", ");
  const tools = body.allowed_tools.length === 0 ? "none" : body.allowed_tools.join(", ");
  return (
    `Agent ${body.agent_id} may spend at most ${inr(body.max_per_txn_paise)} per transaction ` +
    `and ${inr(body.max_total_paise)} total for "${body.purpose}", from ${body.valid_from} until ${body.valid_until}. ` +
    `Counterparties: ${counterparties}. Tools: ${tools}. ` +
    `Step-up above ${inr(body.step_up_above_paise)}.`
  );
}
