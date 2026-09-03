/**
 * Deterministic 50-attempt batch seed (FR-80).
 * Fixed scenario order — no PRNG. Clock is injected by the harness.
 *
 * Cumulative-cap group (FR-13): a dedicated mandate with max_total_paise such
 * that N otherwise-valid proposals settle, then the rest deny CUM_CAP_EXCEEDED.
 * The proxy evaluates settled + live reservations; this seed does not compute
 * remaining budget from Settlement rows alone.
 */

export const BATCH_TOTAL = 50;

export const CUM_CAP_AGENT = "agent_cum_cap";
export const CUM_CAP_AMOUNT_PAISE = 1000;
/** 4 × 1000 paise fills the cap; further otherwise-valid proposals deny. */
export const CUM_CAP_MAX_TOTAL_PAISE = 4000;
export const CUM_CAP_SETTLEMENTS = 4;

export type BatchExpect =
  | "STEP_UP_THRESHOLD"
  | "ALLOW"
  | "CUM_CAP_EXCEEDED"
  | "PER_TXN_CAP_EXCEEDED"
  | "COUNTERPARTY_NOT_ALLOWED"
  | "TOOL_UNCLASSIFIED"
  | "TOOL_NOT_ALLOWED"
  | "WINDOW_EXPIRED";

export type BatchAttempt = {
  expect: BatchExpect;
  agent: string;
  amountPaise: number;
  counterparty: string;
  tool: string;
  failProvision: boolean;
  freezeNowExpired: boolean;
};

export function expectedReason(i: number): BatchExpect {
  if (i < 5) return "STEP_UP_THRESHOLD";
  if (i < 20) return "ALLOW";
  if (i < 24) return "CUM_CAP_EXCEEDED";
  if (i < 32) return "PER_TXN_CAP_EXCEEDED";
  if (i < 38) return "COUNTERPARTY_NOT_ALLOWED";
  if (i < 43) return "TOOL_UNCLASSIFIED";
  if (i < 46) return "TOOL_NOT_ALLOWED";
  return "WINDOW_EXPIRED";
}

export function isCumCapGroup(i: number): boolean {
  return i >= 16 && i < 24;
}

export function batchAttempt(i: number): BatchAttempt {
  const expect = expectedReason(i);
  let amountPaise = 1000;
  let counterparty = "prov_compute_a";
  let tool = "create_order";
  const agent = isCumCapGroup(i) ? CUM_CAP_AGENT : "agent_demo";
  if (expect === "PER_TXN_CAP_EXCEEDED") amountPaise = 20_000;
  if (expect === "COUNTERPARTY_NOT_ALLOWED") counterparty = "prov_compute_a1";
  if (expect === "STEP_UP_THRESHOLD") amountPaise = 4500;
  if (expect === "TOOL_UNCLASSIFIED") tool = "create_payout";
  if (expect === "TOOL_NOT_ALLOWED") tool = "fetch_all_orders";
  if (isCumCapGroup(i)) amountPaise = CUM_CAP_AMOUNT_PAISE;
  return {
    expect,
    agent,
    amountPaise,
    counterparty,
    tool,
    failProvision: i >= 13 && i < 16,
    freezeNowExpired: expect === "WINDOW_EXPIRED",
  };
}
