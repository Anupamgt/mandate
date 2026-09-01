import { describe, expect, it } from "vitest";
import { loadUpstreamTools } from "../classify.js";
import { handleMcpJsonRpc } from "./jsonrpc.js";

const tools = loadUpstreamTools();

const handlers = {
  session: { agentId: undefined as string | undefined },
  tools,
  now: new Date("2026-09-02T12:00:00.000Z"),
  loadMandate: async () => null,
  ledgerFor: async () => ({
    settledPaise: 0,
    reservedPaise: 0,
    recentProposeCount: 0,
    rateLimitPerMinute: 30,
  }),
  remaining: async () => ({ remaining_paise: 0 }),
  onAllow: async () => ({ ok: true }),
  onReadForward: async (tool: string, args: Record<string, unknown>) => ({ tool, args }),
};

describe("MCP JSON-RPC (stdio / streamable HTTP)", () => {
  it("initialize then tools/list is 42 Razorpay tools + mandate.status", async () => {
    await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { _meta: { agent_id: "agent_demo" } } },
      handlers,
    );
    expect(handlers.session.agentId).toBe("agent_demo");
    const listed = (await handleMcpJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, handlers)) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools).toHaveLength(43);
    expect(listed.result.tools.map((t) => t.name)).toContain("create_order");
    expect(listed.result.tools.map((t) => t.name)).toContain("mandate.status");
  });

  it("tools/call create_payout is TOOL_UNCLASSIFIED", async () => {
    const res = (await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_payout", arguments: {} } },
      handlers,
    )) as { result: { isError: boolean; content: { text: string }[] } };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]?.text).toContain("TOOL_UNCLASSIFIED");
  });

  it("tools/call MONEY without agent_id is NO_MANDATE", async () => {
    const fresh = { ...handlers, session: { agentId: undefined as string | undefined } };
    const res = (await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "create_order", arguments: { amount: 100 } },
      },
      fresh,
    )) as { result: { content: { text: string }[] } };
    expect(res.result.content[0]?.text).toContain("NO_MANDATE");
  });
});
