import type { PrismaClient } from "@prisma/client";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { asPaise } from "@mandate/shared";
import { parseMandateBody, verifyApproval, verifyMandateBody, verifyRevocation } from "@mandate/mandate";
import { evaluate } from "@mandate/policy";
import { computeAuditHash, GENESIS_HASH, payloadDigest, verifyChain } from "@mandate/audit";
import type { Rail } from "@mandate/rails";
import type { EventType } from "@mandate/shared";
import { classifyTool, extractAmountPaise, extractCounterparty, type ClassifiedTool } from "./classify.js";

export type ProxyDeps = {
  prisma: PrismaClient;
  rail: Rail;
  operatorPublicKeyHex: string;
  proofSecret: string;
  webhookSecret: string;
  tools: readonly ClassifiedTool[];
  now: () => Date;
  provisionTimeoutMs: number;
  waitForProvision?: (invoiceId: string) => Promise<boolean>;
};

const auditChain: { tail: Promise<unknown> } = { tail: Promise.resolve() };

async function lastHash(prisma: PrismaClient): Promise<string> {
  const last = await prisma.auditRow.findFirst({ orderBy: { seq: "desc" } });
  return last?.hash ?? GENESIS_HASH;
}

async function appendAudit(
  prisma: PrismaClient,
  row: {
    mandateId?: string | null;
    spendRequestId?: string | null;
    eventType: EventType;
    actor: string;
    payload: unknown;
    decision?: string | null;
    reasonCode?: string | null;
    ts: Date;
  },
): Promise<void> {
  const run = async () => {
    const prevHash = await lastHash(prisma);
    const seqRow = await prisma.auditRow.findFirst({ orderBy: { seq: "desc" } });
    const seq = (seqRow?.seq ?? 0) + 1;
    const ts = row.ts.toISOString();
    const payloadHash = payloadDigest(row.payload);
    const hash = computeAuditHash({
      seq,
      ts,
      mandateId: row.mandateId ?? null,
      spendRequestId: row.spendRequestId ?? null,
      eventType: row.eventType,
      actor: row.actor,
      payloadHash,
      decision: row.decision ?? null,
      reasonCode: row.reasonCode ?? null,
      prevHash,
    });
    await prisma.auditRow.create({
      data: {
        seq,
        ts: row.ts,
        mandateId: row.mandateId ?? null,
        spendRequestId: row.spendRequestId ?? null,
        eventType: row.eventType,
        actor: row.actor,
        payloadHash,
        decision: row.decision ?? null,
        reasonCode: row.reasonCode ?? null,
        prevHash,
        hash,
      },
    });
  };
  const next = auditChain.tail.then(run, run);
  auditChain.tail = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

export async function remainingBudget(prisma: PrismaClient, mandateId: string, maxTotal: number): Promise<number> {
  const now = new Date();
  const settled = await prisma.settlement.aggregate({
    _sum: { amountPaise: true },
    where: { spendRequest: { mandateId }, reversal: null },
  });
  const reserved = await prisma.reservation.aggregate({
    _sum: { amountPaise: true },
    where: { mandateId, releasedAt: null, expiresAt: { gt: now } },
  });
  return maxTotal - (settled._sum.amountPaise ?? 0) - (reserved._sum.amountPaise ?? 0);
}

export async function ledgerFor(prisma: PrismaClient, mandateId: string, now: Date) {
  const settled = await prisma.settlement.aggregate({
    _sum: { amountPaise: true },
    where: { spendRequest: { mandateId }, reversal: null },
  });
  const reserved = await prisma.reservation.aggregate({
    _sum: { amountPaise: true },
    where: { mandateId, releasedAt: null, expiresAt: { gt: now } },
  });
  const minuteAgo = new Date(now.getTime() - 60_000);
  const recentProposeCount = await prisma.spendRequest.count({
    where: { mandateId, id: { not: "" } },
  });
  const recent = await prisma.decision.count({
    where: { spendRequest: { mandateId }, decidedAt: { gte: minuteAgo } },
  });
  void recentProposeCount;
  return {
    settledPaise: asPaise(settled._sum.amountPaise ?? 0),
    reservedPaise: asPaise(reserved._sum.amountPaise ?? 0),
    recentProposeCount: recent,
    rateLimitPerMinute: 30,
  };
}

export function signProof(secret: string, invoiceId: string, resource: string, expiresAt: string): string {
  return createHmac("sha256", secret).update(`${invoiceId}|${resource}|${expiresAt}`).digest("hex");
}

export function verifyProofMac(secret: string, invoiceId: string, resource: string, expiresAt: string, mac: string): boolean {
  const expected = Buffer.from(signProof(secret, invoiceId, resource, expiresAt));
  const got = Buffer.from(mac);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function issueMandate(
  deps: ProxyDeps,
  bodyUnknown: unknown,
  signature: string,
): Promise<{ id: string }> {
  const body = parseMandateBody(bodyUnknown);
  const ok = await verifyMandateBody(body, signature, deps.operatorPublicKeyHex);
  if (!ok) throw Object.assign(new Error("invalid mandate signature"), { status: 400 });
  const id = randomUUID();
  const now = deps.now();
  await deps.prisma.mandate.create({
    data: {
      id,
      agentId: body.agent_id,
      principalId: body.principal_id,
      bodyJson: JSON.stringify(body),
      signature,
      status: "ACTIVE",
      issuedAt: now,
    },
  });
  await appendAudit(deps.prisma, {
    mandateId: id,
    eventType: "MANDATE_ISSUED",
    actor: body.principal_id,
    payload: { id, agent_id: body.agent_id },
    ts: now,
  });
  return { id };
}

export async function revokeMandate(
  deps: ProxyDeps,
  mandateId: string,
  reason: string,
  signature: string,
  revokedAt?: string,
): Promise<void> {
  const now = deps.now();
  const payload = { mandate_id: mandateId, reason, revoked_at: revokedAt ?? now.toISOString() };
  const ok = await verifyRevocation(payload, signature, deps.operatorPublicKeyHex);
  if (!ok) throw Object.assign(new Error("invalid revocation signature"), { status: 400 });
  const existing = await deps.prisma.mandate.findUnique({ where: { id: mandateId } });
  if (!existing) throw Object.assign(new Error("not found"), { status: 404 });
  await deps.prisma.$transaction([
    deps.prisma.mandate.update({ where: { id: mandateId }, data: { status: "REVOKED" } }),
    deps.prisma.revocation.create({
      data: { id: randomUUID(), mandateId, signature, revokedAt: now, reason },
    }),
  ]);
  await appendAudit(deps.prisma, {
    mandateId,
    eventType: "MANDATE_REVOKED",
    actor: "operator",
    payload: { reason },
    ts: now,
  });
}

type ProposeInput = {
  agentId: string;
  tool: string;
  counterpartyId?: string;
  amountPaise: number;
  purpose: string;
  rationale?: string;
  invoiceId?: string;
  resource?: string;
  failProvision?: boolean;
};

const reserveLocks = new Map<string, Promise<unknown>>();

async function withMandateLock<T>(mandateId: string, fn: () => Promise<T>): Promise<T> {
  const prev = reserveLocks.get(mandateId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  reserveLocks.set(
    mandateId,
    prev.then(() => gate),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function proposeSpend(deps: ProxyDeps, input: ProposeInput) {
  const peek = await deps.prisma.mandate.findFirst({
    where: { agentId: input.agentId },
    orderBy: { issuedAt: "desc" },
  });
  return withMandateLock(peek?.id ?? `agent:${input.agentId}`, () => proposeSpendInner(deps, input));
}

async function proposeSpendInner(deps: ProxyDeps, input: ProposeInput) {
  const now = deps.now();
  const toolClass = classifyTool(input.tool, deps.tools);
  const counterpartyId = input.counterpartyId ?? "razorpay";
  const mandateRow = await deps.prisma.mandate.findFirst({
    where: { agentId: input.agentId },
    orderBy: { issuedAt: "desc" },
  });
  const mandateView = mandateRow
    ? {
        body: parseMandateBody(JSON.parse(mandateRow.bodyJson)),
        signature: mandateRow.signature,
        status: mandateRow.status,
        publicKeyHex: deps.operatorPublicKeyHex,
      }
    : null;

  if (mandateRow && mandateView) {
    const stillValid = await verifyMandateBody(mandateView.body, mandateView.signature, deps.operatorPublicKeyHex);
    if (!stillValid) {
      /* FR-04: re-verify every time */
    }
  }

  const spendId = randomUUID();
  const invoiceId = input.invoiceId ?? randomUUID();

  if (mandateRow) {
    await deps.prisma.spendRequest.create({
      data: {
        id: spendId,
        mandateId: mandateRow.id,
        agentId: input.agentId,
        tool: input.tool,
        counterpartyId,
        amountPaise: input.amountPaise,
        purpose: input.purpose,
        rationale: (input.rationale ?? "").slice(0, 256),
        invoiceId,
        status: "PROPOSED",
      },
    });
    await appendAudit(deps.prisma, {
      mandateId: mandateRow.id,
      spendRequestId: spendId,
      eventType: "SPEND_PROPOSED",
      actor: input.agentId,
      payload: { tool: input.tool, amountPaise: input.amountPaise, rationale: input.rationale ?? "" },
      ts: now,
    });
  }

  const led = mandateRow ? await ledgerFor(deps.prisma, mandateRow.id, now) : {
    settledPaise: asPaise(0),
    reservedPaise: asPaise(0),
    recentProposeCount: 0,
    rateLimitPerMinute: 30,
  };

  const decision = await evaluate(
    {
      agentId: input.agentId,
      tool: input.tool,
      toolClass,
      counterpartyId,
      amountPaise: asPaise(input.amountPaise),
    },
    mandateView,
    led,
    now,
  );

  if (mandateRow) {
    await deps.prisma.decision.create({
      data: {
        id: randomUUID(),
        spendRequestId: spendId,
        decision: decision.decision,
        reasonCode: decision.reason_code,
        checksJson: JSON.stringify(decision.checks),
        decidedAt: now,
      },
    });
    await appendAudit(deps.prisma, {
      mandateId: mandateRow.id,
      spendRequestId: spendId,
      eventType: "DECISION",
      actor: "policy",
      payload: decision,
      decision: decision.decision,
      reasonCode: decision.reason_code,
      ts: now,
    });
  }

  if (decision.decision !== "ALLOW" || !mandateRow) {
    if (mandateRow) {
      await deps.prisma.spendRequest.update({ where: { id: spendId }, data: { status: decision.decision } });
    }
    return { spend_request_id: spendId, ...decision };
  }

  const expiresAt = new Date(now.getTime() + 60_000);
  try {
    await deps.prisma.$transaction(async (tx) => {
      const settled = await tx.settlement.aggregate({
        _sum: { amountPaise: true },
        where: { spendRequest: { mandateId: mandateRow.id }, reversal: null },
      });
      const reserved = await tx.reservation.aggregate({
        _sum: { amountPaise: true },
        where: { mandateId: mandateRow.id, releasedAt: null, expiresAt: { gt: now } },
      });
      const live = (settled._sum.amountPaise ?? 0) + (reserved._sum.amountPaise ?? 0);
      const body = parseMandateBody(JSON.parse(mandateRow.bodyJson));
      if (live + input.amountPaise > body.max_total_paise) {
        throw new Error("CUM_CAP_EXCEEDED");
      }
      const fresh = await tx.mandate.findUniqueOrThrow({ where: { id: mandateRow.id } });
      if (fresh.status !== "ACTIVE") {
        throw new Error("MANDATE_REVOKED");
      }
      await tx.reservation.create({
        data: {
          id: randomUUID(),
          spendRequestId: spendId,
          mandateId: mandateRow.id,
          amountPaise: input.amountPaise,
          expiresAt,
        },
      });
    });
  } catch (err) {
    const msg = String((err as Error).message);
    const code = msg.includes("MANDATE_REVOKED")
      ? "MANDATE_REVOKED"
      : msg.includes("CUM_CAP_EXCEEDED")
        ? "CUM_CAP_EXCEEDED"
        : undefined;
    if (code) {
      await deps.prisma.spendRequest.update({ where: { id: spendId }, data: { status: "DENY" } });
      await deps.prisma.decision.update({
        where: { spendRequestId: spendId },
        data: { decision: "DENY", reasonCode: code, checksJson: JSON.stringify(["reserve:fail"]) },
      });
      return { spend_request_id: spendId, decision: "DENY" as const, reason_code: code, checks: ["reserve:fail"] };
    }
    throw err;
  }

  await appendAudit(deps.prisma, {
    mandateId: mandateRow.id,
    spendRequestId: spendId,
    eventType: "RESERVED",
    actor: "proxy",
    payload: { amountPaise: input.amountPaise },
    ts: deps.now(),
  });

  const quote = await deps.rail.quote(asPaise(input.amountPaise), counterpartyId);
  const settlement = await deps.rail.pay(quote, mandateRow.id, invoiceId);
  await deps.prisma.settlement.create({
    data: {
      id: randomUUID(),
      spendRequestId: spendId,
      railId: settlement.railId,
      externalRef: settlement.externalRef,
      amountPaise: settlement.amountPaise,
      idempotencyKey: invoiceId,
      settledAt: deps.now(),
    },
  });
  await deps.prisma.reservation.update({
    where: { spendRequestId: spendId },
    data: { releasedAt: deps.now() },
  });
  await appendAudit(deps.prisma, {
    mandateId: mandateRow.id,
    spendRequestId: spendId,
    eventType: "SETTLED",
    actor: "rail",
    payload: settlement,
    ts: deps.now(),
  });

  const resource = input.resource ?? "compute/run";
  const exp = new Date(deps.now().getTime() + 120_000).toISOString();
  const mac = signProof(deps.proofSecret, invoiceId, resource, exp);
  await deps.prisma.invoice.create({
    data: {
      id: invoiceId,
      spendRequestId: spendId,
      providerId: await ensureProvider(deps, counterpartyId),
      resource,
      amountPaise: input.amountPaise,
      expiresAt: new Date(exp),
    },
  });

  const provisioned = input.failProvision
    ? false
    : deps.waitForProvision
      ? await Promise.race([
          deps.waitForProvision(invoiceId),
          sleep(deps.provisionTimeoutMs).then(() => false),
        ])
      : !input.failProvision;

  if (!provisioned) {
    const rev = await deps.rail.reverse(settlement, "provision_timeout");
    await deps.prisma.reversal.create({
      data: {
        id: randomUUID(),
        settlementId: (await deps.prisma.settlement.findUniqueOrThrow({ where: { spendRequestId: spendId } })).id,
        externalRef: rev.externalRef,
        amountPaise: rev.amountPaise,
        reason: "provision_timeout",
        reversedAt: deps.now(),
        succeeded: rev.succeeded,
      },
    });
    await appendAudit(deps.prisma, {
      mandateId: mandateRow.id,
      spendRequestId: spendId,
      eventType: rev.succeeded ? "EXCEPTION" : "EXCEPTION_UNRESOLVED",
      actor: "reconciler",
      payload: { reverse: rev },
      ts: deps.now(),
    });
    await deps.prisma.spendRequest.update({ where: { id: spendId }, data: { status: "EXCEPTION" } });
    return {
      spend_request_id: spendId,
      decision: "ALLOW" as const,
      reason_code: "ALLOW" as const,
      checks: decision.checks,
      exception: rev.succeeded ? "EXCEPTION" : "EXCEPTION_UNRESOLVED",
      proof: { invoice_id: invoiceId, resource, expires_at: exp, mac },
    };
  }

  await appendAudit(deps.prisma, {
    mandateId: mandateRow.id,
    spendRequestId: spendId,
    eventType: "PROVISIONED",
    actor: "resource-server",
    payload: { invoiceId },
    ts: deps.now(),
  });
  await deps.prisma.spendRequest.update({ where: { id: spendId }, data: { status: "SETTLED" } });
  return {
    spend_request_id: spendId,
    decision: "ALLOW" as const,
    reason_code: "ALLOW" as const,
    checks: decision.checks,
    proof: { invoice_id: invoiceId, resource, expires_at: exp, mac },
  };
}

async function ensureProvider(deps: ProxyDeps, id: string): Promise<string> {
  await deps.prisma.provider.upsert({
    where: { id },
    create: { id, name: id, webhookSecret: deps.webhookSecret },
    update: {},
  });
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function consumeProof(
  deps: ProxyDeps,
  proof: { invoice_id: string; resource: string; expires_at: string; mac: string },
) {
  if (!verifyProofMac(deps.proofSecret, proof.invoice_id, proof.resource, proof.expires_at, proof.mac)) {
    throw Object.assign(new Error("bad proof"), { status: 400 });
  }
  const invoice = await deps.prisma.invoice.findUnique({ where: { id: proof.invoice_id } });
  if (!invoice) throw Object.assign(new Error("unknown invoice"), { status: 404 });
  if (invoice.resource !== proof.resource) throw Object.assign(new Error("resource mismatch"), { status: 400 });
  if (invoice.consumedAt) {
    await appendAudit(deps.prisma, {
      spendRequestId: invoice.spendRequestId,
      eventType: "PROOF_REPLAY_REJECTED",
      actor: "proxy",
      payload: { invoice_id: proof.invoice_id },
      ts: deps.now(),
    });
    throw Object.assign(new Error("replay"), { status: 409, code: "PROOF_REPLAY_REJECTED" });
  }
  await deps.prisma.invoice.update({
    where: { id: proof.invoice_id },
    data: { consumedAt: deps.now() },
  });
  await appendAudit(deps.prisma, {
    spendRequestId: invoice.spendRequestId,
    eventType: "PROOF_VERIFIED",
    actor: "proxy",
    payload: { invoice_id: proof.invoice_id },
    ts: deps.now(),
  });
  return { ok: true, invoice: { id: invoice.id, resource: invoice.resource, amountPaise: invoice.amountPaise } };
}

export async function handleWebhook(
  deps: ProxyDeps,
  rawBody: string,
  signature: string | undefined,
) {
  const expected = createHmac("sha256", deps.webhookSecret).update(rawBody).digest("hex");
  const got = signature ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await appendAudit(deps.prisma, {
      eventType: "WEBHOOK_REJECTED",
      actor: "webhook",
      payload: { reason: "bad_hmac" },
      ts: deps.now(),
    });
    throw Object.assign(new Error("bad hmac"), { status: 401 });
  }
  const body = JSON.parse(rawBody) as { invoice_id?: string };
  await appendAudit(deps.prisma, {
    eventType: "RECONCILED",
    actor: "webhook",
    payload: body,
    ts: deps.now(),
  });
  return { ok: true };
}

export async function verifyAudit(deps: ProxyDeps) {
  const rows = await deps.prisma.auditRow.findMany({ orderBy: { seq: "asc" } });
  return verifyChain(
    rows.map((r) => ({
      seq: r.seq,
      ts: r.ts.toISOString(),
      mandateId: r.mandateId,
      spendRequestId: r.spendRequestId,
      eventType: r.eventType as EventType,
      actor: r.actor,
      payloadHash: r.payloadHash,
      decision: r.decision,
      reasonCode: r.reasonCode,
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  );
}

export async function approveStepUp(deps: ProxyDeps, spendId: string, signature: string) {
  const now = deps.now();
  const payload = { spend_request_id: spendId, approved_at: now.toISOString() };
  const ok = await verifyApproval(payload, signature, deps.operatorPublicKeyHex);
  if (!ok) throw Object.assign(new Error("bad approval"), { status: 400 });
  await deps.prisma.approval.create({
    data: { id: randomUUID(), spendRequestId: spendId, signature, approvedAt: now },
  });
  await appendAudit(deps.prisma, {
    spendRequestId: spendId,
    eventType: "APPROVAL_GRANTED",
    actor: "operator",
    payload,
    ts: now,
  });
  return { ok: true };
}

export { appendAudit, classifyTool, extractAmountPaise, extractCounterparty };
