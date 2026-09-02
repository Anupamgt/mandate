#!/usr/bin/env node
/**
 * MCP stdio entry using @modelcontextprotocol/sdk StdioServerTransport
 * (newline-delimited JSON-RPC — not LSP Content-Length framing).
 *
 * Session agent_id: MANDATE_AGENT_ID on the server process.
 * Cursor / Claude Desktop: set that env on the MCP server config.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createAppFromEnv } from "./runtime.js";
import { handleMcpJsonRpc, type McpSession } from "./mcp/jsonrpc.js";
import { makeMcpHandlers } from "./mcp/handlers.js";

const runtime = await createAppFromEnv();
const session: McpSession = {};
if (process.env.MANDATE_AGENT_ID) session.agentId = process.env.MANDATE_AGENT_ID;

export function createStdioServer() {
  const server = new Server({ name: "mandate-proxy", version: "0.3.0" }, { capabilities: { tools: { listChanged: false } } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const res = (await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      makeMcpHandlers(runtime.deps, session),
    )) as { result: { tools: unknown[] } };
    return res.result;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const res = (await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: request.params.name, arguments: request.params.arguments ?? {} },
      },
      makeMcpHandlers(runtime.deps, session),
    )) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    return res.result;
  });

  return server;
}

const server = createStdioServer();
await server.connect(new StdioServerTransport());
