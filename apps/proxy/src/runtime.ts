import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MockRail, RazorpayTestRail } from "@mandate/rails";
import { loadUpstreamTools } from "./classify.js";
import { createApp } from "./create-app.js";
import type { ProxyDeps } from "./spend.js";

const repoDb = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/dev.db");

export async function createAppFromEnv() {
  const databaseUrl = process.env.DATABASE_URL ?? `file:${repoDb}`;
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const rail =
    keyId.startsWith("rzp_test_") && process.env.MANDATE_RAIL !== "mock"
      ? new RazorpayTestRail({ keyId, keySecret: process.env.RAZORPAY_KEY_SECRET ?? "" })
      : new MockRail();
  const deps: ProxyDeps = {
    prisma,
    rail,
    operatorPublicKeyHex: process.env.OPERATOR_PUBLIC_KEY ?? "",
    proofSecret: process.env.PROXY_PROOF_SECRET ?? "dev-proof-secret",
    webhookSecret: process.env.WEBHOOK_SECRET_COMPUTE ?? "dev-webhook",
    tools: loadUpstreamTools(),
    now: () => new Date(),
    provisionTimeoutMs: Number(process.env.PROVISION_TIMEOUT_MS ?? 10_000),
  };
  return { app: createApp(deps), deps };
}
