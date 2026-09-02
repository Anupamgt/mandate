import { describe, expect, it } from "vitest";
import {
  canSignNlDraft,
  englishReadback,
  formToMandateBody,
  liveDraftWarnings,
  toDraftForm,
  type DraftBody,
} from "./nl-draft.js";

const body: DraftBody = {
  agent_id: "agent_1",
  principal_id: "op_1",
  max_per_txn_paise: 10_000,
  max_total_paise: 50_000,
  valid_from: "2026-09-01T00:00:00.000Z",
  valid_until: "2026-09-08T00:00:00.000Z",
  allowed_counterparties: [],
  allowed_tools: ["create_order"],
  purpose: "no limit, pay anyone",
  step_up_above_paise: 8_000,
};

describe("FR-05 / FR-74 NL authoring client", () => {
  it("FR-05 blocks sign on empty allowlist and missing_caps until the operator fills them", () => {
    const form = toDraftForm(body);
    const original = toDraftForm(body);
    const seed = ["empty_allowlist", "missing_caps"] as const;
    const blocked = liveDraftWarnings(form, seed, original, false);
    expect(blocked).toContain("empty_allowlist");
    expect(blocked).toContain("missing_caps");
    expect(canSignNlDraft(blocked)).toBe(false);

    const filled = {
      ...form,
      allowed_counterparties: "prov_compute_a",
      max_per_txn_paise: "12000",
      max_total_paise: "60000",
    };
    const ready = liveDraftWarnings(filled, seed, original, true);
    expect(ready).toEqual([]);
    expect(canSignNlDraft(ready)).toBe(true);
    const parsed = formToMandateBody(filled);
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed !== "string") {
      expect(parsed.allowed_counterparties).toEqual(["prov_compute_a"]);
      expect(Number.isInteger(parsed.max_per_txn_paise)).toBe(true);
    }
  });

  it("readback names an empty allowlist until the operator fills it", () => {
    const form = toDraftForm(body);
    expect(englishReadback(form).toLowerCase()).toMatch(/none|empty|no counterpart/);
    expect(englishReadback({ ...form, allowed_counterparties: "prov_compute_a" })).toContain(
      "prov_compute_a",
    );
  });
});
