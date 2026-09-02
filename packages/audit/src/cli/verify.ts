#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyChain, type AuditRecord } from "../chain.js";

const require = createRequire(import.meta.url);

async function loadRows(path: string): Promise<AuditRecord[]> {
  if (path.endsWith(".json")) {
    return JSON.parse(readFileSync(path, "utf8")) as AuditRecord[];
  }
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: `file:${path}` });
  try {
    const rows = await prisma.auditRow.findMany({ orderBy: { seq: "asc" } });
    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts.toISOString(),
      mandateId: r.mandateId,
      spendRequestId: r.spendRequestId,
      eventType: r.eventType as AuditRecord["eventType"],
      actor: r.actor,
      payloadHash: r.payloadHash,
      decision: r.decision,
      reasonCode: r.reasonCode,
      prevHash: r.prevHash,
      hash: r.hash,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

const path = process.argv[2];
if (!path) {
  console.error("usage: audit:verify <file.json|sqlite.db>");
  process.exit(2);
}

const rows = await loadRows(path);
const result = verifyChain(rows);
if (result.ok) {
  console.log("ok");
  process.exit(0);
}
console.log(`break at seq ${result.first_break_seq}`);
process.exit(1);
