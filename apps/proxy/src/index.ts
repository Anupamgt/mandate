import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, name: "mandate-proxy" }));

export { app };
