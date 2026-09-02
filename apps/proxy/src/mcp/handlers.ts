import { parseMandateBody } from "@mandate/mandate";
import { appendAudit, ledgerFor, proposeSpend, remainingBudget, type ProxyDeps } from "../spend.js";
import { handleMcpJsonRpc, type McpHandlers, type McpSession } from "./jsonrpc.js";
import type { GovernAllow } from "./govern.js";

/** Shared MCP session handlers for stdio (SDK transport) and POST /mcp. */
export function makeMcpHandlers(deps: ProxyDeps, session: McpSession): McpHandlers {
  const rateLimitPerMinute = deps.rateLimitPerMinute ?? 30;
  return {
    session,
    tools: deps.tools,
    now: deps.now(),
    loadMandate: async (id) => {
      const row = await deps.prisma.mandate.findFirst({
        where: { agentId: id },
        orderBy: { issuedAt: "desc" },
      });
      if (!row) return null;
      return {
        body: parseMandateBody(JSON.parse(row.bodyJson)),
        signature: row.signature,
        status: row.status,
        publicKeyHex: deps.operatorPublicKeyHex,
      };
    },
    ledgerFor: async (mandate) => {
      const row = await deps.prisma.mandate.findFirst({
        where: { agentId: mandate.body.agent_id },
        orderBy: { issuedAt: "desc" },
      });
      if (!row) {
        return { settledPaise: 0, reservedPaise: 0, recentProposeCount: 0, rateLimitPerMinute };
      }
      const led = await ledgerFor(deps.prisma, row.id, deps.now());
      return { ...led, rateLimitPerMinute };
    },
    remaining: async (agent) => {
      const row = await deps.prisma.mandate.findFirst({
        where: { agentId: agent, status: "ACTIVE" },
      });
      if (!row) return { mandate: null };
      const body = parseMandateBody(JSON.parse(row.bodyJson));
      return {
        mandate_id: row.id,
        status: row.status,
        remaining_paise: await remainingBudget(deps.prisma, row.id, body.max_total_paise),
      };
    },
    onAllow: async (g: GovernAllow) =>
      proposeSpend(deps, {
        agentId: session.agentId ?? "",
        tool: g.tool,
        counterpartyId: g.counterpartyId,
        amountPaise: g.amountPaise,
        purpose: "mcp",
      }),
    onReadForward: async (tool, args) => {
      await appendAudit(deps.prisma, {
        eventType: "TOOL_CALL_READ",
        actor: session.agentId ?? "anonymous",
        payload: { tool, args },
        ts: deps.now(),
      });
      return { forwarded: true, tool, args };
    },
  };
}

export async function dispatchMcp(deps: ProxyDeps, session: McpSession, msg: unknown) {
  return handleMcpJsonRpc(msg as { method?: string; id?: string | number | null; params?: Record<string, unknown> }, makeMcpHandlers(deps, session));
}
