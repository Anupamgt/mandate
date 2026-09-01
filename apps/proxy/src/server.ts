import { serve } from "@hono/node-server";
import { createAppFromEnv } from "./runtime.js";

const port = Number(process.env.PORT ?? 18787);
const { app } = await createAppFromEnv();
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`mandate-proxy http://127.0.0.1:${port}`);
console.log(`MCP streamable HTTP POST http://127.0.0.1:${port}/mcp`);
