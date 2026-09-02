import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { MockRail } from "@mandate/rails";
import { generateOperatorKeyPair } from "@mandate/mandate";
import { loadUpstreamTools } from "./classify.js";
import { createApp } from "./create-app.js";
import type { ProxyDeps } from "./spend.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export async function makeTestProxy(opts: { reverseFails?: boolean; rateLimitPerMinute?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mandate-"));
  const dbPath = join(dir, "test.db");
  const databaseUrl = `file:${dbPath}`;
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: join(repoRoot, "packages/db"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const keys = await generateOperatorKeyPair();
  const railOpts = opts.reverseFails ? { reverseFails: true } : {};
  const deps: ProxyDeps = {
    prisma,
    rail: new MockRail(railOpts),
    operatorPublicKeyHex: keys.publicKeyHex,
    proofSecret: "test-proof",
    webhookSecret: "test-webhook",
    tools: loadUpstreamTools(),
    now: () => new Date("2026-09-02T12:00:00.000Z"),
    provisionTimeoutMs: 5,
    waitForProvision: async () => true,
    rateLimitPerMinute: opts.rateLimitPerMinute ?? 30,
  };
  return { app: createApp(deps), deps, keys, dbPath };
}
