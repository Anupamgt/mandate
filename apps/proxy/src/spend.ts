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
  rateLimitPerMinute?: number;
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
  const mandate = await prisma.mandate.findUnique({ where: { id: mandateId } });
  const recent = await prisma.decision.count({
    where: {
      decidedAt: { gte: minuteAgo },
      spendRequest: mandate ? { agentId: mandate.agentId } : { mandateId },
    },
  });
  return {
    settledPaise: asPaise(settled._sum.amountPaise ?? 0),
    reservedPaise: asPaise(reserved._sum.amountPaise ?? 0),
    recentProposeCount: recent,
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

  const led = mandateRow
    ? await ledgerFor(deps.prisma, mandateRow.id, now)
    : { settledPaise: asPaise(0), reservedPaise: asPaise(0), recentProposeCount: 0 };

  if (led.recentProposeCount >= (deps.rateLimitPerMinute ?? 30)) {
    const limited = {
      decision: "DENY" as const,
      reason_code: "RATE_LIMITED" as const,
      checks: ["rate:exceeded"] as const,
    };
    if (mandateRow) {
      await deps.prisma.decision.create({
        data: {
          id: randomUUID(),
          spendRequestId: spendId,
          decision: limited.decision,
          reasonCode: limited.reason_code,
          checksJson: JSON.stringify(limited.checks),
          decidedAt: now,
        },
      });
      await appendAudit(deps.prisma, {
        mandateId: mandateRow.id,
        spendRequestId: spendId,
        eventType: "DECISION",
        actor: "policy",
        payload: limited,
        decision: limited.decision,
        reasonCode: limited.reason_code,
        ts: now,
      });
      await deps.prisma.spendRequest.update({ where: { id: spendId }, data: { status: "DENY" } });
    }
    return { spend_request_id: spendId, ...limited };
  }

  const decision = await evaluate(
    {
      agentId: input.agentId,
      tool: input.tool,
      toolClass,
      counterpartyId,
      amountPaise: asPaise(input.amountPaise),
    },
    mandateView,
    { settledPaise: led.settledPaise, reservedPaise: led.reservedPaise },
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

  return reserveThenPay(deps, {
    spendId,
    mandateRow,
    amountPaise: input.amountPaise,
    counterpartyId,
    invoiceId,
    resource: input.resource ?? "compute/run",
    checks: decision.checks,
    failProvision: Boolean(input.failProvision),
  });
}

async function reserveThenPay(
  deps: ProxyDeps,
  args: {
    spendId: string;
    mandateRow: { id: string; bodyJson: string };
    amountPaise: number;
    counterpartyId: string;
    invoiceId: string;
    resource: string;
    checks: readonly string[];
    failProvision?: boolean;
  },
) {
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + 60_000);
  try {
    await deps.prisma.$transaction(async (tx) => {
      const settled = await tx.settlement.aggregate({
        _sum: { amountPaise: true },
        where: { spendRequest: { mandateId: args.mandateRow.id }, reversal: null },
      });
      const reserved = await tx.reservation.aggregate({
        _sum: { amountPaise: true },
        where: { mandateId: args.mandateRow.id, releasedAt: null, expiresAt: { gt: now } },
      });
      const live = (settled._sum.amountPaise ?? 0) + (reserved._sum.amountPaise ?? 0);
      const body = parseMandateBody(JSON.parse(args.mandateRow.bodyJson));
      if (live + args.amountPaise > body.max_total_paise) {
        throw new Error("CUM_CAP_EXCEEDED");
      }
      const fresh = await tx.mandate.findUniqueOrThrow({ where: { id: args.mandateRow.id } });
      if (fresh.status !== "ACTIVE") {
        throw new Error("MANDATE_REVOKED");
      }
      const sigOk = await verifyMandateBody(body, fresh.signature, deps.operatorPublicKeyHex);
      if (!sigOk) {
        throw new Error("MANDATE_SIG_INVALID");
      }
      await tx.reservation.create({
        data: {
          id: randomUUID(),
          spendRequestId: args.spendId,
          mandateId: args.mandateRow.id,
          amountPaise: args.amountPaise,
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
        : msg.includes("MANDATE_SIG_INVALID")
          ? "MANDATE_SIG_INVALID"
          : undefined;
    if (code) {
      await deps.prisma.spendRequest.update({ where: { id: args.spendId }, data: { status: "DENY" } });
      await deps.prisma.decision.update({
        where: { spendRequestId: args.spendId },
        data: { decision: "DENY", reasonCode: code, checksJson: JSON.stringify(["reserve:fail"]) },
      });
      return {
        spend_request_id: args.spendId,
        decision: "DENY" as const,
        reason_code: code,
        checks: ["reserve:fail"],
        proof: null,
      };
    }
    throw err;
  }

  await appendAudit(deps.prisma, {
    mandateId: args.mandateRow.id,
    spendRequestId: args.spendId,
    eventType: "RESERVED",
    actor: "proxy",
    payload: { amountPaise: args.amountPaise },
    ts: deps.now(),
  });

  const quote = await deps.rail.quote(asPaise(args.amountPaise), args.counterpartyId);
  const settlement = await deps.rail.pay(quote, args.mandateRow.id, args.invoiceId);
  await deps.prisma.settlement.create({
    data: {
      id: randomUUID(),
      spendRequestId: args.spendId,
      railId: settlement.railId,
      externalRef: settlement.externalRef,
      amountPaise: settlement.amountPaise,
      idempotencyKey: args.invoiceId,
      settledAt: deps.now(),
    },
  });
  await deps.prisma.reservation.update({
    where: { spendRequestId: args.spendId },
    data: { releasedAt: deps.now() },
  });
  await appendAudit(deps.prisma, {
    mandateId: args.mandateRow.id,
    spendRequestId: args.spendId,
    eventType: "SETTLED",
    actor: "rail",
    payload: settlement,
    ts: deps.now(),
  });

  const resource = args.resource;
  const exp = new Date(deps.now().getTime() + 120_000).toISOString();
  const mac = signProof(deps.proofSecret, args.invoiceId, resource, exp);
  await deps.prisma.invoice.create({
    data: {
      id: args.invoiceId,
      spendRequestId: args.spendId,
      providerId: await ensureProvider(deps, args.counterpartyId),
      resource,
      amountPaise: args.amountPaise,
      expiresAt: new Date(exp),
    },
  });

  const provisioned = args.failProvision
    ? false
    : deps.waitForProvision
      ? await Promise.race([
          deps.waitForProvision(args.invoiceId),
          sleep(deps.provisionTimeoutMs).then(() => false),
        ])
      : !args.failProvision;

  if (!provisioned) {
    const rev = await deps.rail.reverse(settlement, "provision_timeout");
    await deps.prisma.reversal.create({
      data: {
        id: randomUUID(),
        settlementId: (await deps.prisma.settlement.findUniqueOrThrow({ where: { spendRequestId: args.spendId } }))
          .id,
        externalRef: rev.externalRef,
        amountPaise: rev.amountPaise,
        reason: "provision_timeout",
        reversedAt: deps.now(),
        succeeded: rev.succeeded,
      },
    });
    await appendAudit(deps.prisma, {
      mandateId: args.mandateRow.id,
      spendRequestId: args.spendId,
      eventType: rev.succeeded ? "EXCEPTION" : "EXCEPTION_UNRESOLVED",
      actor: "reconciler",
      payload: { reverse: rev },
      ts: deps.now(),
    });
    await deps.prisma.spendRequest.update({ where: { id: args.spendId }, data: { status: "EXCEPTION" } });
    return {
      spend_request_id: args.spendId,
      decision: "ALLOW" as const,
      reason_code: "ALLOW" as const,
      checks: args.checks,
      exception: rev.succeeded ? "EXCEPTION" : "EXCEPTION_UNRESOLVED",
      proof: { invoice_id: args.invoiceId, resource, expires_at: exp, mac },
    };
  }

  await appendAudit(deps.prisma, {
    mandateId: args.mandateRow.id,
    spendRequestId: args.spendId,
    eventType: "PROVISIONED",
    actor: "resource-server",
    payload: { invoiceId: args.invoiceId },
    ts: deps.now(),
  });
  await deps.prisma.spendRequest.update({ where: { id: args.spendId }, data: { status: "SETTLED" } });
  return {
    spend_request_id: args.spendId,
    decision: "ALLOW" as const,
    reason_code: "ALLOW" as const,
    checks: args.checks,
    proof: { invoice_id: args.invoiceId, resource, expires_at: exp, mac },
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

export async function listPendingApprovals(deps: ProxyDeps) {
  const rows = await deps.prisma.spendRequest.findMany({
    where: { status: "STEP_UP", approval: { is: null }, settlement: { is: null } },
    include: { decision: true },
    orderBy: { id: "asc" },
  });
  return {
    pending: rows.map((row) => ({
      spend_request_id: row.id,
      mandate_id: row.mandateId,
      agent_id: row.agentId,
      tool: row.tool,
      counterparty_id: row.counterpartyId,
      amount_paise: row.amountPaise,
      purpose: row.purpose,
      status: row.status,
      reason_code: row.decision?.reasonCode ?? "STEP_UP_THRESHOLD",
      decided_at: row.decision?.decidedAt.toISOString() ?? null,
    })),
  };
}

export async function approveStepUp(
  deps: ProxyDeps,
  spendId: string,
  signature: string | undefined,
  approvedAt: string | undefined,
  claimedSpendId?: string,
) {
  if (!signature || !approvedAt) {
    throw Object.assign(new Error("bad approval"), { status: 400 });
  }
  if (claimedSpendId && claimedSpendId !== spendId) {
    throw Object.assign(new Error("spend_request_id mismatch"), { status: 400 });
  }
  const approvedAtDate = new Date(approvedAt);
  if (Number.isNaN(approvedAtDate.getTime())) {
    throw Object.assign(new Error("bad approval"), { status: 400 });
  }
  const payload = { spend_request_id: spendId, approved_at: approvedAt };
  const ok = await verifyApproval(payload, signature, deps.operatorPublicKeyHex);
  if (!ok) throw Object.assign(new Error("bad approval"), { status: 400 });

  const spend = await deps.prisma.spendRequest.findUnique({
    where: { id: spendId },
    include: { approval: true, settlement: true, mandate: true, decision: true },
  });
  if (!spend) throw Object.assign(new Error("not found"), { status: 404 });
  if (spend.approval || spend.settlement) {
    throw Object.assign(new Error("already approved"), { status: 409 });
  }
  if (spend.status !== "STEP_UP") {
    throw Object.assign(new Error("not awaiting approval"), { status: 400 });
  }

  const now = deps.now();
  const mandateView = {
    body: parseMandateBody(JSON.parse(spend.mandate.bodyJson)),
    signature: spend.mandate.signature,
    status: spend.mandate.status,
    publicKeyHex: deps.operatorPublicKeyHex,
  };
  const led = await ledgerFor(deps.prisma, spend.mandateId, now);
  const decision = await evaluate(
    {
      agentId: spend.agentId,
      tool: spend.tool,
      toolClass: classifyTool(spend.tool, deps.tools),
      counterpartyId: spend.counterpartyId,
      amountPaise: asPaise(spend.amountPaise),
    },
    mandateView,
    { settledPaise: led.settledPaise, reservedPaise: led.reservedPaise },
    now,
  );

  if (decision.decision === "DENY") {
    return {
      spend_request_id: spendId,
      decision: decision.decision,
      reason_code: decision.reason_code,
      checks: decision.checks,
      proof: null,
    };
  }

  await deps.prisma.approval.create({
    data: { id: randomUUID(), spendRequestId: spendId, signature, approvedAt: approvedAtDate },
  });
  await appendAudit(deps.prisma, {
    mandateId: spend.mandateId,
    spendRequestId: spendId,
    eventType: "APPROVAL_GRANTED",
    actor: "operator",
    payload,
    ts: now,
  });

  return withMandateLock(spend.mandateId, () =>
    reserveThenPay(deps, {
      spendId,
      mandateRow: spend.mandate,
      amountPaise: spend.amountPaise,
      counterpartyId: spend.counterpartyId,
      invoiceId: spend.invoiceId ?? randomUUID(),
      resource: "compute/run",
      checks: decision.checks,
    }),
  );
}

export { appendAudit, classifyTool, extractAmountPaise, extractCounterparty };
