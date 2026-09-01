import { asPaise, type ReasonCode, type ToolClass } from "@mandate/shared";
import { evaluate, type MandateView } from "@mandate/policy";
import { classifyTool, extractAmountPaise, extractCounterparty, type ClassifiedTool } from "../classify.js";

export type GovernDeny = {
  kind: "deny";
  reason_code: ReasonCode;
  checks: readonly string[];
  decision: "DENY" | "STEP_UP";
};

export type GovernForward = {
  kind: "forward";
  tool: string;
  toolClass: ToolClass;
  args: Record<string, unknown>;
};

export type GovernStatus = {
  kind: "status";
  agentId: string;
};

export type GovernAllow = {
  kind: "allow";
  tool: string;
  toolClass: ToolClass;
  args: Record<string, unknown>;
  amountPaise: number;
  counterpartyId: string;
};

export type GovernResult = GovernDeny | GovernForward | GovernStatus | GovernAllow;

export type GovernInput = {
  agentId: string | undefined;
  toolName: string;
  args: Record<string, unknown>;
  tools: readonly ClassifiedTool[];
  loadMandate: (agentId: string) => Promise<MandateView | null>;
  ledgerFor: (mandate: MandateView) => Promise<{
    settledPaise: number;
    reservedPaise: number;
    recentProposeCount: number;
    rateLimitPerMinute: number;
  }>;
  now: Date;
};

/**
 * FR-20/21/22/23 — classify and gate an MCP tools/call before any upstream forward.
 */
export async function governToolCall(input: GovernInput): Promise<GovernResult> {
  const { toolName, args, tools, now } = input;

  if (toolName === "mandate.status") {
    if (!input.agentId) {
      return { kind: "deny", reason_code: "NO_MANDATE", checks: ["session:no_agent_id"], decision: "DENY" };
    }
    return { kind: "status", agentId: input.agentId };
  }

  const toolClass = classifyTool(toolName, tools);

  if (toolClass === "UNCLASSIFIED") {
    return {
      kind: "deny",
      reason_code: "TOOL_UNCLASSIFIED",
      checks: ["tool_class:unclassified"],
      decision: "DENY",
    };
  }

  if (toolClass === "READ") {
    return { kind: "forward", tool: toolName, toolClass, args };
  }

  if (!input.agentId) {
    return { kind: "deny", reason_code: "NO_MANDATE", checks: ["session:no_agent_id"], decision: "DENY" };
  }

  const mandate = await input.loadMandate(input.agentId);
  const amountPaise = extractAmountPaise(args);
  const counterpartyId = extractCounterparty(args);
  const ledger = mandate
    ? await input.ledgerFor(mandate)
    : { settledPaise: 0, reservedPaise: 0, recentProposeCount: 0, rateLimitPerMinute: 30 };

  const result = await evaluate(
    {
      agentId: input.agentId,
      tool: toolName,
      toolClass,
      counterpartyId,
      amountPaise: asPaise(amountPaise),
    },
    mandate,
    {
      settledPaise: asPaise(ledger.settledPaise),
      reservedPaise: asPaise(ledger.reservedPaise),
      recentProposeCount: ledger.recentProposeCount,
      rateLimitPerMinute: ledger.rateLimitPerMinute,
    },
    now,
  );

  if (result.decision !== "ALLOW") {
    return {
      kind: "deny",
      reason_code: result.reason_code,
      checks: result.checks,
      decision: result.decision,
    };
  }

  return {
    kind: "allow",
    tool: toolName,
    toolClass,
    args,
    amountPaise,
    counterpartyId,
  };
}
