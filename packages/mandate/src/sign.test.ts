import { describe, expect, it } from "vitest";
import { asPaise } from "@mandate/shared";
import { generateOperatorKeyPair, parseMandateBody, signMandateBody, verifyMandateBody } from "./index.js";

describe("FR-01/FR-02 mandate sign/verify", () => {
  it("round-trips a valid body", async () => {
    const keys = await generateOperatorKeyPair();
    const body = parseMandateBody({
      agent_id: "agent_demo",
      principal_id: "op",
      max_per_txn_paise: 100,
      max_total_paise: 500,
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: "2026-09-10T00:00:00.000Z",
      allowed_counterparties: ["prov_a"],
      allowed_tools: ["create_order"],
      purpose: "test",
      step_up_above_paise: 90,
    });
    const sig = await signMandateBody(body, keys.privateKeyHex);
    expect(await verifyMandateBody(body, sig, keys.publicKeyHex)).toBe(true);
  });

  it("RT-06 tampering one field fails verify", async () => {
    const keys = await generateOperatorKeyPair();
    const body = parseMandateBody({
      agent_id: "agent_demo",
      principal_id: "op",
      max_per_txn_paise: 100,
      max_total_paise: 500,
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: "2026-09-10T00:00:00.000Z",
      allowed_counterparties: ["prov_a"],
      allowed_tools: ["create_order"],
      purpose: "test",
      step_up_above_paise: 90,
    });
    const sig = await signMandateBody(body, keys.privateKeyHex);
    const tampered = { ...body, max_per_txn_paise: asPaise(999) };
    expect(await verifyMandateBody(tampered, sig, keys.publicKeyHex)).toBe(false);
  });

  it("rejects non-integer paise", () => {
    expect(() =>
      parseMandateBody({
        agent_id: "a",
        principal_id: "p",
        max_per_txn_paise: 1.5,
        max_total_paise: 10,
        valid_from: "2026-09-01T00:00:00.000Z",
        valid_until: "2026-09-10T00:00:00.000Z",
        allowed_counterparties: [],
        allowed_tools: [],
        purpose: "x",
        step_up_above_paise: 1,
      }),
    ).toThrow();
  });
});
