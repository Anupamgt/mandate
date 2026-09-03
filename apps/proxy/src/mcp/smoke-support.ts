import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOperatorKeyPair, parseMandateBody, signMandateBody } from "@mandate/mandate";

/** Seeded smoke mandate. max_total < max_per_txn so CUM_CAP is reachable without filling the ledger. */
export const SMOKE_CAPS = {
  max_per_txn_paise: 10_000,
  max_total_paise: 5_000,
  per_txn_over: 20_000,
  cum_over: 6_000,
} as const;

export const SMOKE_AGENT = "agent_demo";
export const SMOKE_TOOL = "update_refund";

export type StructuredDenial = {
  decision: string;
  reason_code: string;
  checks: unknown;
};

export function parseDenialText(text: string): StructuredDenial {
  const body = JSON.parse(text) as Record<string, unknown>;
  if (typeof body.decision !== "string" || typeof body.reason_code !== "string" || !("checks" in body)) {
    throw new Error(`not a structured denial: ${text}`);
  }
  return { decision: body.decision, reason_code: body.reason_code, checks: body.checks };
}

export function parseToolDenial(result: { content?: Array<{ type: string; text?: string }> }): StructuredDenial {
  const text = result.content?.find((c) => c.type === "text" && typeof c.text === "string")?.text;
  if (!text) throw new Error("tool result has no text content");
  return parseDenialText(text);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function seedSmokeMandate(): Promise<{
  databaseUrl: string;
  publicKeyHex: string;
}> {
  const dir = mkdtempSync(join(tmpdir(), "mandate-mcp-smoke-"));
  const dbPath = join(dir, "smoke.db");
  const databaseUrl = `file:${dbPath}`;
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: join(repoRoot, "packages/db"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const keys = await generateOperatorKeyPair();
  const body = parseMandateBody({
    agent_id: SMOKE_AGENT,
    principal_id: "op",
    max_per_txn_paise: SMOKE_CAPS.max_per_txn_paise,
    max_total_paise: SMOKE_CAPS.max_total_paise,
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_until: "2099-01-01T00:00:00.000Z",
    allowed_counterparties: ["prov_compute_a", "razorpay"],
    allowed_tools: ["create_order", "update_refund"],
    purpose: "mcp-smoke",
    step_up_above_paise: 8_000,
  });
  const signature = await signMandateBody(body, keys.privateKeyHex);
  await prisma.mandate.create({
    data: {
      id: "mcp-smoke-mandate",
      agentId: body.agent_id,
      principalId: body.principal_id,
      bodyJson: JSON.stringify(body),
      signature,
      status: "ACTIVE",
      issuedAt: new Date("2026-09-02T12:00:00.000Z"),
    },
  });
  await prisma.$disconnect();
  return { databaseUrl, publicKeyHex: keys.publicKeyHex };
}

export function createSmokeClient(opts: { databaseUrl: string; publicKeyHex: string }): {
  client: Client;
  transport: StdioClientTransport;
} {
  const tsxCli = join(repoRoot, "node_modules/tsx/dist/cli.mjs");
  const entry = join(repoRoot, "apps/proxy/src/mcp-stdio.ts");
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    DATABASE_URL: opts.databaseUrl,
    OPERATOR_PUBLIC_KEY: opts.publicKeyHex,
    MANDATE_AGENT_ID: SMOKE_AGENT,
    MANDATE_RAIL: "mock",
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, entry],
    env,
    cwd: join(repoRoot, "apps/proxy"),
    stderr: "pipe",
  });
  const client = new Client({ name: "mandate-mcp-smoke", version: "0.3.0" });
  return { client, transport };
}
