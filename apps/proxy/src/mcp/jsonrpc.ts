import type { MandateView } from "@mandate/policy";
import type { ClassifiedTool } from "../classify.js";
import { governToolCall, type GovernAllow } from "./govern.js";
import { loadUpstreamTools } from "../classify.js";

export type McpSession = {
  agentId?: string;
};

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

export type McpHandlers = {
  session: McpSession;
  tools: readonly ClassifiedTool[];
  now: Date;
  loadMandate: (agentId: string) => Promise<MandateView | null>;
  ledgerFor: (mandate: MandateView) => Promise<{
    settledPaise: number;
    reservedPaise: number;
    recentProposeCount: number;
    rateLimitPerMinute: number;
  }>;
  remaining: (agentId: string) => Promise<unknown>;
  onAllow: (g: GovernAllow) => Promise<unknown>;
  onReadForward: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
};

function ok(id: JsonRpc["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: JsonRpc["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

function textResult(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }], isError: false };
}

function denyResult(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }], isError: true };
}

export async function handleMcpJsonRpc(msg: JsonRpc, h: McpHandlers): Promise<unknown> {
  const method = msg.method ?? "";
  if (method === "initialize") {
    const params = msg.params ?? {};
    const meta = (params._meta ?? params.meta ?? {}) as Record<string, unknown>;
    const client = (params.clientInfo ?? {}) as Record<string, unknown>;
    const agent =
      (typeof meta.agent_id === "string" && meta.agent_id) ||
      (typeof client.agent_id === "string" && client.agent_id) ||
      h.session.agentId;
    if (typeof agent === "string" && agent.length > 0) {
      h.session.agentId = agent;
    }
    return ok(msg.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mandate-proxy", version: "0.3.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return {};
  }
  if (method === "ping") {
    return ok(msg.id, {});
  }
  if (method === "tools/list") {
    const dumped = h.tools.length > 0 ? h.tools : loadUpstreamTools();
    const tools = [
      ...dumped.map((t) => ({
        name: t.name,
        description: `[${t.class}] ${t.description}`,
        inputSchema: { type: "object", additionalProperties: true },
      })),
      {
        name: "mandate.status",
        description: "[READ] Remaining budget and status for the session agent_id",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    return ok(msg.id, { tools });
  }
  if (method === "tools/call") {
    const params = msg.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const governed = await governToolCall({
      agentId: h.session.agentId,
      toolName: name,
      args,
      tools: h.tools,
      loadMandate: h.loadMandate,
      ledgerFor: h.ledgerFor,
      now: h.now,
    });
    if (governed.kind === "deny") {
      return ok(msg.id, denyResult(governed));
    }
    if (governed.kind === "status") {
      return ok(msg.id, textResult(await h.remaining(governed.agentId)));
    }
    if (governed.kind === "forward") {
      return ok(msg.id, textResult(await h.onReadForward(governed.tool, governed.args)));
    }
    const settled = await h.onAllow(governed);
    return ok(msg.id, textResult(settled));
  }
  return err(msg.id, -32601, `unknown method ${method}`);
}
