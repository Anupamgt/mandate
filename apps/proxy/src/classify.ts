import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isToolClass, type ToolClass } from "@mandate/shared";

export type ClassifiedTool = {
  name: string;
  description: string;
  class: ToolClass;
};

type Dump = {
  tools: { name: string; description?: string; class: string }[];
};

export function loadUpstreamTools(dumpPath?: string): ClassifiedTool[] {
  const path =
    dumpPath ??
    join(dirname(fileURLToPath(import.meta.url)), "../config/upstream-tools.json");
  const dump = JSON.parse(readFileSync(path, "utf8")) as Dump;
  return dump.tools.map((t) => {
    if (!isToolClass(t.class)) {
      throw new Error(`unclassified dump entry ${t.name}`);
    }
    return { name: t.name, description: t.description ?? "", class: t.class };
  });
}

export function classifyTool(
  name: string,
  tools: readonly ClassifiedTool[],
): ToolClass | "UNCLASSIFIED" {
  if (name === "mandate.status") return "READ";
  const hit = tools.find((t) => t.name === name);
  return hit?.class ?? "UNCLASSIFIED";
}

export function assertClassificationComplete(upstreamNames: readonly string[], tools: readonly ClassifiedTool[]): void {
  const known = new Set(tools.map((t) => t.name));
  for (const name of upstreamNames) {
    if (!known.has(name)) {
      throw new Error(`FR-21 missing classification for ${name}`);
    }
  }
}

export function extractAmountPaise(args: Record<string, unknown>): number {
  const raw = args.amount_paise ?? args.amount ?? args.amountPaise ?? 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

export function extractCounterparty(args: Record<string, unknown>): string {
  const raw =
    args.counterparty_id ??
    args.counterpartyId ??
    args.account_number ??
    args.contact_id ??
    args.email ??
    "razorpay";
  return typeof raw === "string" && raw.length > 0 ? raw : "razorpay";
}
