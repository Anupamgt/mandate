import { asPaise, type Paise, type ReasonCode, type ToolClass } from "@mandate/shared";
import { verifyMandateBody, type MandateBody } from "@mandate/mandate";

export type PolicyDecision = "ALLOW" | "DENY" | "STEP_UP";

export type PolicyResult = {
  decision: PolicyDecision;
  reason_code: ReasonCode;
  checks: readonly string[];
};

export type SpendReq = {
  agentId: string;
  tool: string;
  toolClass: ToolClass | "UNCLASSIFIED";
  counterpartyId: string;
  amountPaise: Paise;
};

export type MandateView = {
  body: MandateBody;
  signature: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  publicKeyHex: string;
};

export type LedgerView = {
  settledPaise: Paise;
  reservedPaise: Paise;
};

function deny(reason_code: ReasonCode, checks: string[]): PolicyResult {
  return { decision: "DENY", reason_code, checks };
}

function pass(name: string, checks: string[]): string[] {
  checks.push(`${name}:pass`);
  return checks;
}

/**
 * FR-10/FR-11 / PRD §6.2. Pure besides Ed25519 verify (no I/O, no Date.now()).
 * Fixed check order — first failure short-circuits to DENY. Step-up only if every prior check passes:
 * signature → status → window → agent → tool → counterparty → per-txn → cumulative → step-up.
 */
export async function evaluate(
  req: SpendReq,
  mandate: MandateView | null,
  ledger: LedgerView,
  now: Date,
): Promise<PolicyResult> {
  const checks: string[] = [];

  if (mandate === null) {
    return deny("NO_MANDATE", ["mandate:missing"]);
  }

  const sigOk = await verifyMandateBody(mandate.body, mandate.signature, mandate.publicKeyHex);
  if (!sigOk) {
    return deny("MANDATE_SIG_INVALID", [...checks, "signature:fail"]);
  }
  pass("signature", checks);

  if (mandate.status === "REVOKED") {
    return deny("MANDATE_REVOKED", [...checks, "status:revoked"]);
  }
  if (mandate.status === "EXPIRED") {
    return deny("MANDATE_EXPIRED", [...checks, "status:expired"]);
  }
  pass("status", checks);

  const from = Date.parse(mandate.body.valid_from);
  const until = Date.parse(mandate.body.valid_until);
  const t = now.getTime();
  if (Number.isNaN(from) || t < from) {
    return deny("WINDOW_NOT_STARTED", [...checks, "window:not_started"]);
  }
  if (Number.isNaN(until) || t > until) {
    return deny("WINDOW_EXPIRED", [...checks, "window:expired"]);
  }
  pass("window", checks);

  if (req.agentId !== mandate.body.agent_id) {
    return deny("AGENT_MISMATCH", [...checks, "agent:mismatch"]);
  }
  pass("agent", checks);

  if (req.toolClass === "UNCLASSIFIED") {
    return deny("TOOL_UNCLASSIFIED", [...checks, "tool:unclassified"]);
  }
  if (!mandate.body.allowed_tools.includes(req.tool)) {
    return deny("TOOL_NOT_ALLOWED", [...checks, "tool:not_allowed"]);
  }
  pass("tool", checks);

  if (!mandate.body.allowed_counterparties.includes(req.counterpartyId)) {
    return deny("COUNTERPARTY_NOT_ALLOWED", [...checks, "counterparty:not_allowed"]);
  }
  pass("counterparty", checks);

  if (req.amountPaise > mandate.body.max_per_txn_paise) {
    return deny("PER_TXN_CAP_EXCEEDED", [...checks, "per_txn:exceeded"]);
  }
  pass("per_txn", checks);

  const live = asPaise(ledger.settledPaise + ledger.reservedPaise);
  if (live + req.amountPaise > mandate.body.max_total_paise) {
    return deny("CUM_CAP_EXCEEDED", [...checks, "cumulative:exceeded"]);
  }
  pass("cumulative", checks);

  if (req.amountPaise > mandate.body.step_up_above_paise) {
    return {
      decision: "STEP_UP",
      reason_code: "STEP_UP_THRESHOLD",
      checks: [...checks, "step_up:required"],
    };
  }
  pass("step_up", checks);

  return { decision: "ALLOW", reason_code: "ALLOW", checks };
}
