import { describe, expect, it } from "vitest";
import { asPaise } from "@mandate/shared";
import { generateOperatorKeyPair, parseMandateBody, signMandateBody } from "@mandate/mandate";
import { classifyTool, loadUpstreamTools } from "../classify.js";
import { governToolCall } from "./govern.js";
import type { MandateView } from "@mandate/policy";

const tools = loadUpstreamTools();
const NOW = new Date("2026-09-02T12:00:00.000Z");

async function mandate(): Promise<MandateView> {
  const keys = await generateOperatorKeyPair();
  const body = parseMandateBody({
    agent_id: "agent_demo",
    principal_id: "op",
    max_per_txn_paise: 5000,
    max_total_paise: 20_000,
    valid_from: "2026-09-01T00:00:00.000Z",
    valid_until: "2026-09-10T00:00:00.000Z",
    allowed_counterparties: ["prov_compute_a", "razorpay"],
    allowed_tools: ["create_order", "update_refund"],
    purpose: "demo",
    step_up_above_paise: 4000,
  });
  return {
    body,
    signature: await signMandateBody(body, keys.privateKeyHex),
    status: "ACTIVE",
    publicKeyHex: keys.publicKeyHex,
  };
}

const emptyLedger = {
  settledPaise: 0,
  reservedPaise: 0,
  recentProposeCount: 0,
  rateLimitPerMinute: 30,
};

describe("FR-20/21/22/23 MCP governance", () => {
  it("re-exposes every dumped Razorpay tool plus mandate.status", () => {
    expect(tools).toHaveLength(42);
    expect(tools.some((t) => t.name === "create_order")).toBe(true);
    expect(tools.some((t) => t.name === "update_refund")).toBe(true);
    expect(classifyTool("mandate.status", tools)).toBe("READ");
  });

  it("FR-23 MONEY_* with no agent_id → NO_MANDATE", async () => {
    const result = await governToolCall({
      agentId: undefined,
      toolName: "create_order",
      args: { amount: 1000, counterparty_id: "prov_compute_a" },
      tools,
      loadMandate: async () => null,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") expect(result.reason_code).toBe("NO_MANDATE");
  });

  it("FR-21 unclassified tool → TOOL_UNCLASSIFIED", async () => {
    const result = await governToolCall({
      agentId: "agent_demo",
      toolName: "create_payout",
      args: {},
      tools,
      loadMandate: async () => null,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") expect(result.reason_code).toBe("TOOL_UNCLASSIFIED");
  });

  it("FR-22 READ tools pass through without a mandate", async () => {
    const result = await governToolCall({
      agentId: undefined,
      toolName: "fetch_all_orders",
      args: {},
      tools,
      loadMandate: async () => null,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("forward");
  });

  it("FR-22 MONEY_* over cap is a structured denial", async () => {
    const view = await mandate();
    const result = await governToolCall({
      agentId: "agent_demo",
      toolName: "create_order",
      args: { amount: 10_000, counterparty_id: "prov_compute_a" },
      tools,
      loadMandate: async () => view,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") expect(result.reason_code).toBe("PER_TXN_CAP_EXCEEDED");
  });

  it("FR-22 MONEY_* ALLOW when inside the mandate", async () => {
    const view = await mandate();
    const result = await governToolCall({
      agentId: "agent_demo",
      toolName: "create_order",
      args: { amount: 1000, counterparty_id: "prov_compute_a" },
      tools,
      loadMandate: async () => view,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("allow");
  });

  it("mandate.status requires agent_id", async () => {
    const result = await governToolCall({
      agentId: undefined,
      toolName: "mandate.status",
      args: {},
      tools,
      loadMandate: async () => null,
      ledgerFor: async () => emptyLedger,
      now: NOW,
    });
    expect(result.kind).toBe("deny");
    if (result.kind === "deny") expect(result.reason_code).toBe("NO_MANDATE");
  });
});

describe("FR-14 extractors", () => {
  it("amount is integer paise", () => {
    expect(asPaise(1000)).toBe(1000);
  });
});
