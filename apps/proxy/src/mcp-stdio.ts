#!/usr/bin/env node
/**
 * MCP stdio entry. Session agent_id comes from MANDATE_AGENT_ID.
 * Cursor / Claude Desktop: set that env on the server process.
 */
import { createInterface } from "node:readline";
import { createAppFromEnv } from "./runtime.js";
import { handleMcpJsonRpc, type McpSession } from "./mcp/jsonrpc.js";

const runtime = await createAppFromEnv();
const session: McpSession = {};
if (process.env.MANDATE_AGENT_ID) session.agentId = process.env.MANDATE_AGENT_ID;

function write(msg: unknown) {
  const json = JSON.stringify(msg);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  void drain();
});

async function drain() {
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buf.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buf = buf.subarray(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) return;
    const body = buf.subarray(start, start + len).toString("utf8");
    buf = buf.subarray(start + len);
    const msg = JSON.parse(body) as { method?: string; id?: string | number | null; params?: Record<string, unknown> };
    const result = await handleMcpJsonRpc(msg, {
      session,
      tools: runtime.deps.tools,
      now: runtime.deps.now(),
      loadMandate: async (id) => {
        const { parseMandateBody } = await import("@mandate/mandate");
        const row = await runtime.deps.prisma.mandate.findFirst({
          where: { agentId: id },
        });
        if (!row) return null;
        return {
          body: parseMandateBody(JSON.parse(row.bodyJson)),
          signature: row.signature,
          status: row.status,
          publicKeyHex: runtime.deps.operatorPublicKeyHex,
        };
      },
      ledgerFor: async (mandate) => {
        const { ledgerFor } = await import("./spend.js");
        const row = await runtime.deps.prisma.mandate.findFirst({
          where: { agentId: mandate.body.agent_id },
        });
        if (!row) {
          return { settledPaise: 0, reservedPaise: 0, recentProposeCount: 0, rateLimitPerMinute: 30 };
        }
        return ledgerFor(runtime.deps.prisma, row.id, runtime.deps.now());
      },
      remaining: async (agent) => {
        const { remainingBudget } = await import("./spend.js");
        const { parseMandateBody } = await import("@mandate/mandate");
        const row = await runtime.deps.prisma.mandate.findFirst({
          where: { agentId: agent, status: "ACTIVE" },
        });
        if (!row) return { mandate: null };
        const body = parseMandateBody(JSON.parse(row.bodyJson));
        return {
          mandate_id: row.id,
          remaining_paise: await remainingBudget(runtime.deps.prisma, row.id, body.max_total_paise),
        };
      },
      onAllow: async (g) => {
        const { proposeSpend } = await import("./spend.js");
        return proposeSpend(runtime.deps, {
          agentId: session.agentId ?? "",
          tool: g.tool,
          counterpartyId: g.counterpartyId,
          amountPaise: g.amountPaise,
          purpose: "mcp",
        });
      },
      onReadForward: async (tool, args) => ({ forwarded: true, tool, args, note: "READ pass-through" }),
    });
    if (msg.id !== undefined) write(result);
  }
}

createInterface({ input: process.stdin });
