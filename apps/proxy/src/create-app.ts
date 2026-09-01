import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { parseMandateBody } from "@mandate/mandate";
import {
  approveStepUp,
  consumeProof,
  handleWebhook,
  issueMandate,
  proposeSpend,
  remainingBudget,
  revokeMandate,
  verifyAudit,
  type ProxyDeps,
} from "./spend.js";
import { type McpSession } from "./mcp/jsonrpc.js";
import { dispatchMcp } from "./mcp/handlers.js";
import { loadUpstreamTools } from "./classify.js";
import { governToolCall } from "./mcp/govern.js";

export function createApp(deps: ProxyDeps) {
  const app = new Hono();
  app.use("/*", cors());

  const sessions = new Map<string, McpSession>();

  app.get("/health", (c) => c.json({ ok: true, name: "mandate-proxy" }));

  app.post("/operator/register", async (c) => {
    const body = await c.req.json();
    const key = String(body.public_key ?? "");
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      return c.json({ error: "expected 32-byte ed25519 public key hex" }, 400);
    }
    deps.operatorPublicKeyHex = key;
    return c.json({ ok: true });
  });

  app.post("/mandates", async (c) => {
    const body = await c.req.json();
    try {
      const issued = await issueMandate(deps, body.body, body.signature);
      return c.json(issued, 201);
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.post("/mandates/:id/revoke", async (c) => {
    const body = await c.req.json();
    try {
      await revokeMandate(
        deps,
        c.req.param("id"),
        body.reason ?? "revoked",
        body.signature,
        body.revoked_at,
      );
      return c.json({ ok: true });
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.get("/mandates/:id", async (c) => {
    const row = await deps.prisma.mandate.findUnique({ where: { id: c.req.param("id") } });
    if (!row) return c.json({ error: "not found" }, 404);
    const body = parseMandateBody(JSON.parse(row.bodyJson));
    const remaining_paise = await remainingBudget(deps.prisma, row.id, body.max_total_paise);
    return c.json({
      id: row.id,
      status: row.status,
      agent_id: row.agentId,
      body,
      remaining_paise,
    });
  });

  app.get("/mandates", async (c) => {
    const rows = await deps.prisma.mandate.findMany({ orderBy: { issuedAt: "desc" } });
    const out = [];
    for (const row of rows) {
      const body = parseMandateBody(JSON.parse(row.bodyJson));
      out.push({
        id: row.id,
        status: row.status,
        agent_id: row.agentId,
        body,
        remaining_paise: await remainingBudget(deps.prisma, row.id, body.max_total_paise),
      });
    }
    return c.json({ mandates: out });
  });

  app.post("/spend/propose", async (c) => {
    const body = await c.req.json();
    try {
      const result = await proposeSpend(deps, {
        agentId: String(body.agent_id),
        tool: String(body.tool),
        counterpartyId: body.counterparty_id,
        amountPaise: Number(body.amount_paise),
        purpose: String(body.purpose ?? "spend"),
        rationale: body.rationale,
        invoiceId: body.invoice_id,
        resource: body.resource,
        failProvision: Boolean(body.fail_provision),
      });
      return c.json(result);
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.post("/spend/:id/approve", async (c) => {
    const body = await c.req.json();
    try {
      return c.json(await approveStepUp(deps, c.req.param("id"), body.signature));
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.post("/proofs/verify", async (c) => {
    try {
      return c.json(await consumeProof(deps, await c.req.json()));
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.post("/webhooks/provision", async (c) => {
    const raw = await c.req.text();
    try {
      return c.json(await handleWebhook(deps, raw, c.req.header("x-webhook-signature")));
    } catch (e) {
      return errorJson(c, e);
    }
  });

  app.get("/audit", async (c) => {
    const mandateId = c.req.query("mandate_id");
    const rows = await deps.prisma.auditRow.findMany({
      where: mandateId ? { mandateId } : {},
      orderBy: { seq: "asc" },
    });
    return c.json({ rows });
  });

  app.get("/audit/verify", async (c) => c.json(await verifyAudit(deps)));

  app.get("/exceptions", async (c) => {
    const rows = await deps.prisma.auditRow.findMany({
      where: { eventType: { in: ["EXCEPTION", "EXCEPTION_UNRESOLVED"] } },
      orderBy: { seq: "desc" },
    });
    return c.json({ exceptions: rows });
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const start = deps.now();
      let lastSeq = 0;
      for (let i = 0; i < 30; i += 1) {
        const rows = await deps.prisma.auditRow.findMany({
          where: { seq: { gt: lastSeq }, eventType: "DECISION" },
          orderBy: { seq: "asc" },
        });
        for (const row of rows) {
          lastSeq = row.seq;
          await stream.writeSSE({ data: JSON.stringify(row), event: "decision", id: String(row.seq) });
        }
        await stream.sleep(500);
        if (deps.now().getTime() - start.getTime() > 15_000) break;
      }
    }),
  );

  app.post("/mcp", async (c) => {
    const headerAgent = c.req.header("x-mandate-agent-id") ?? c.req.query("agent_id");
    const sessionId = c.req.header("mcp-session-id") ?? "anon";
    const session: McpSession = sessions.get(sessionId) ?? {};
    if (headerAgent) session.agentId = headerAgent;
    sessions.set(sessionId, session);
    const msg = await c.req.json();
    const result = await dispatchMcp(deps, session, msg);
    return c.json(result);
  });

  app.get("/mcp", (c) => c.json({ error: "use POST" }, 405));

  return app;
}

function errorJson(c: { json: (b: unknown, s?: number) => Response }, e: unknown) {
  const err = e as { status?: number; message?: string; code?: string };
  const status = (err.status ?? 500) as 400 | 401 | 404 | 409 | 500;
  return c.json({ error: err.message ?? "error", code: err.code }, status);
}

export { loadUpstreamTools, governToolCall };
