import { serve } from "@hono/node-server";
import { createResourceApp } from "./app.js";

const port = Number(process.env.RESOURCE_PORT ?? 18788);
const app = createResourceApp({
  proxyBaseUrl: process.env.PROXY_URL ?? "http://127.0.0.1:18787",
  webhookSecret: process.env.WEBHOOK_SECRET_COMPUTE ?? "dev-webhook",
});
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`mandate-resource-server http://127.0.0.1:${port}`);
