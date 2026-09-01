import { describe, expect, it } from "vitest";
import { asPaise } from "@mandate/shared";
import {
  generateOperatorKeyPair,
  parseMandateBody,
  signMandateBody,
  type MandateBody,
} from "@mandate/mandate";
import { evaluate, type LedgerView, type MandateView, type SpendReq } from "./evaluate.js";

const NOW = new Date("2026-09-02T12:00:00.000Z");

async function signedMandate(overrides: Partial<MandateBody> = {}): Promise<{
  view: MandateView;
  keys: { privateKeyHex: string; publicKeyHex: string };
  body: MandateBody;
}> {
  const keys = await generateOperatorKeyPair();
  const body = parseMandateBody({
    agent_id: "agent_demo",
    principal_id: "op_anupam",
    max_per_txn_paise: 10_000,
    max_total_paise: 50_000,
    valid_from: "2026-09-01T00:00:00.000Z",
    valid_until: "2026-09-10T00:00:00.000Z",
    allowed_counterparties: ["prov_compute_a"],
    allowed_tools: ["create_order", "update_refund"],
    purpose: "showcase compute",
    step_up_above_paise: 9_000,
    ...overrides,
  });
  const signature = await signMandateBody(body, keys.privateKeyHex);
  return {
    body,
    keys,
    view: { body, signature, status: "ACTIVE", publicKeyHex: keys.publicKeyHex },
  };
}

function req(over: Partial<SpendReq> = {}): SpendReq {
  return {
    agentId: "agent_demo",
    tool: "create_order",
    toolClass: "MONEY_IN",
    counterpartyId: "prov_compute_a",
    amountPaise: asPaise(1000),
    ...over,
  };
}

function ledger(over: Partial<LedgerView> = {}): LedgerView {
  return {
    settledPaise: asPaise(0),
    reservedPaise: asPaise(0),
    recentProposeCount: 0,
    rateLimitPerMinute: 30,
    ...over,
  };
}

describe("FR-10/FR-11 evaluate()", () => {
  it("ALLOW when every check passes", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req(), view, ledger(), NOW);
    expect(result.decision).toBe("ALLOW");
    expect(result.reason_code).toBe("ALLOW");
  });

  it("NO_MANDATE when mandate is null", async () => {
    const result = await evaluate(req(), null, ledger(), NOW);
    expect(result.reason_code).toBe("NO_MANDATE");
    expect(result.decision).toBe("DENY");
  });

  it("MANDATE_SIG_INVALID on tampered body (RT-06)", async () => {
    const { view } = await signedMandate();
    const tampered: MandateView = {
      ...view,
      body: { ...view.body, max_per_txn_paise: asPaise(99_999) },
    };
    const result = await evaluate(req(), tampered, ledger(), NOW);
    expect(result.reason_code).toBe("MANDATE_SIG_INVALID");
  });

  it("invalid signature beats revoked status", async () => {
    const { view } = await signedMandate();
    const tampered: MandateView = {
      ...view,
      status: "REVOKED",
      body: { ...view.body, purpose: "tamper" },
    };
    const result = await evaluate(req(), tampered, ledger(), NOW);
    expect(result.reason_code).toBe("MANDATE_SIG_INVALID");
  });

  it("MANDATE_REVOKED", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req(), { ...view, status: "REVOKED" }, ledger(), NOW);
    expect(result.reason_code).toBe("MANDATE_REVOKED");
  });

  it("MANDATE_EXPIRED status", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req(), { ...view, status: "EXPIRED" }, ledger(), NOW);
    expect(result.reason_code).toBe("MANDATE_EXPIRED");
  });

  it("WINDOW_NOT_STARTED", async () => {
    const { view } = await signedMandate({ valid_from: "2026-09-03T00:00:00.000Z" });
    const result = await evaluate(req(), view, ledger(), NOW);
    expect(result.reason_code).toBe("WINDOW_NOT_STARTED");
  });

  it("WINDOW_EXPIRED at valid_until + 1s (RT-07)", async () => {
    const until = "2026-09-02T12:00:00.000Z";
    const { view } = await signedMandate({ valid_until: until });
    const result = await evaluate(req(), view, ledger(), new Date("2026-09-02T12:00:01.000Z"));
    expect(result.reason_code).toBe("WINDOW_EXPIRED");
  });

  it("window passes at valid_until - 1s (RT-07)", async () => {
    const until = "2026-09-02T12:00:00.000Z";
    const { view } = await signedMandate({
      valid_until: until,
      step_up_above_paise: 50_000,
    });
    const result = await evaluate(req(), view, ledger(), new Date("2026-09-02T11:59:59.000Z"));
    expect(result.reason_code).toBe("ALLOW");
  });

  it("AGENT_MISMATCH", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req({ agentId: "other" }), view, ledger(), NOW);
    expect(result.reason_code).toBe("AGENT_MISMATCH");
  });

  it("TOOL_UNCLASSIFIED (RT-09)", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req({ tool: "mystery_payout", toolClass: "UNCLASSIFIED" }), view, ledger(), NOW);
    expect(result.reason_code).toBe("TOOL_UNCLASSIFIED");
  });

  it("TOOL_NOT_ALLOWED", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req({ tool: "capture_payment", toolClass: "MONEY_IN" }), view, ledger(), NOW);
    expect(result.reason_code).toBe("TOOL_NOT_ALLOWED");
  });

  it("COUNTERPARTY_NOT_ALLOWED exact match (RT-08)", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req({ counterpartyId: "prov_compute_a1" }), view, ledger(), NOW);
    expect(result.reason_code).toBe("COUNTERPARTY_NOT_ALLOWED");
  });

  it("PER_TXN_CAP_EXCEEDED", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req({ amountPaise: asPaise(10_001) }), view, ledger(), NOW);
    expect(result.reason_code).toBe("PER_TXN_CAP_EXCEEDED");
  });

  it("boundary: exact per-txn cap passes", async () => {
    const { view } = await signedMandate({ step_up_above_paise: 50_000 });
    const result = await evaluate(req({ amountPaise: asPaise(10_000) }), view, ledger(), NOW);
    expect(result.reason_code).toBe("ALLOW");
  });

  it("CUM_CAP_EXCEEDED includes live reservations", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(
      req({ amountPaise: asPaise(1000) }),
      view,
      ledger({ settledPaise: asPaise(40_000), reservedPaise: asPaise(9_500) }),
      NOW,
    );
    expect(result.reason_code).toBe("CUM_CAP_EXCEEDED");
  });

  it("RATE_LIMITED", async () => {
    const { view } = await signedMandate();
    const result = await evaluate(req(), view, ledger({ recentProposeCount: 30 }), NOW);
    expect(result.reason_code).toBe("RATE_LIMITED");
  });

  it("STEP_UP_THRESHOLD only if prior checks pass", async () => {
    const { view } = await signedMandate({ step_up_above_paise: 500 });
    const result = await evaluate(req({ amountPaise: asPaise(1000) }), view, ledger(), NOW);
    expect(result.decision).toBe("STEP_UP");
    expect(result.reason_code).toBe("STEP_UP_THRESHOLD");
  });
});
