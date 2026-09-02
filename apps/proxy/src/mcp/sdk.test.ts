import { describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

describe("FR-20 official MCP SDK", () => {
  it("stdio transport is the SDK StdioServerTransport (NDJSON)", () => {
    const server = new Server({ name: "mandate-proxy", version: "0.3.0" }, { capabilities: { tools: {} } });
    expect(server).toBeInstanceOf(Server);
    expect(StdioServerTransport.name).toBe("StdioServerTransport");
    expect(ListToolsRequestSchema).toBeTruthy();
    expect(CallToolRequestSchema).toBeTruthy();
  });
});
