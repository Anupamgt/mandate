import { describe, expect, it } from "vitest";
import { parseMandateBody } from "./schema.js";
import {
  canSignMandateDraft,
  draftMandateFromIntent,
  INTENT_MAX_CHARS,
  normalizeMandateDraft,
  readbackMandate,
  remainingDraftWarnings,
} from "./draft.js";

const NOW = new Date("2026-09-02T06:07:00.000Z");

describe("FR-05 NL mandate draft", () => {
  it('draft for "no limit, pay anyone" has explicit caps and empty-allowlist warning', () => {
    const draft = draftMandateFromIntent("no limit, pay anyone", NOW);

    expect(draft.intent).toBe("no limit, pay anyone");
    expect(Number.isInteger(draft.body.max_per_txn_paise)).toBe(true);
    expect(Number.isInteger(draft.body.max_total_paise)).toBe(true);
    expect(draft.body.max_per_txn_paise).toBeGreaterThan(0);
    expect(draft.body.max_total_paise).toBeGreaterThan(0);
    expect(draft.body.max_per_txn_paise).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(draft.body.max_total_paise).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(draft.body.allowed_counterparties).toEqual([]);
    expect(draft.warnings).toContain("empty_allowlist");
    expect(draft.warnings).toContain("missing_caps");
    expect(parseMandateBody(draft.body)).toMatchObject({
      max_per_txn_paise: draft.body.max_per_txn_paise,
      max_total_paise: draft.body.max_total_paise,
    });
    expect(draft).not.toHaveProperty("signature");
    expect(JSON.stringify(draft)).not.toMatch(/sign/i);
  });

  it("never treats unlimited language as unbounded caps, even via normalize", () => {
    const draft = normalizeMandateDraft(
      {
        max_per_txn_paise: Number.MAX_SAFE_INTEGER,
        max_total_paise: Number.MAX_SAFE_INTEGER,
        allowed_counterparties: [],
      },
      "no limit, pay anyone",
      NOW,
    );
    expect(draft.body.max_per_txn_paise).toBeGreaterThan(0);
    expect(draft.body.max_per_txn_paise).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(draft.body.max_total_paise).toBeGreaterThan(0);
    expect(draft.body.max_total_paise).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(draft.warnings).toContain("empty_allowlist");
    expect(draft.warnings).toContain("missing_caps");
  });

  it("SEC-06 truncates intent to 256 chars", () => {
    const intent = `${"pay anyone unlimited ".repeat(40)}end`;
    expect(intent.length).toBeGreaterThan(INTENT_MAX_CHARS);
    const draft = draftMandateFromIntent(intent, NOW);
    expect(draft.intent.length).toBe(INTENT_MAX_CHARS);
  });

  it("blocks signing until the operator fills allowlist and caps", () => {
    const draft = draftMandateFromIntent("no limit, pay anyone", NOW);
    expect(canSignMandateDraft(draft.body, draft.warnings, { original: draft.body })).toBe(false);
    expect(remainingDraftWarnings(draft.body, draft.warnings, { original: draft.body })).toEqual([
      "empty_allowlist",
      "missing_caps",
    ]);

    const filledAllowlist = {
      ...draft.body,
      allowed_counterparties: ["prov_compute_a"],
    };
    expect(remainingDraftWarnings(filledAllowlist, draft.warnings, { original: draft.body })).toEqual([
      "missing_caps",
    ]);

    const filled = {
      ...draft.body,
      allowed_counterparties: ["prov_compute_a"],
      max_per_txn_paise: draft.body.max_per_txn_paise + 100,
      max_total_paise: draft.body.max_total_paise + 100,
    };
    expect(remainingDraftWarnings(filled, draft.warnings, { original: draft.body })).toEqual([]);
    expect(canSignMandateDraft(filled, draft.warnings, { original: draft.body })).toBe(true);
  });

  it("clears missing_caps when the operator touches cap fields", () => {
    const draft = draftMandateFromIntent("no limit, pay anyone", NOW);
    const filled = {
      ...draft.body,
      allowed_counterparties: ["razorpay"],
    };
    expect(
      remainingDraftWarnings(filled, draft.warnings, { original: draft.body, capsTouched: true }),
    ).toEqual([]);
  });

  it("parses explicit rupee caps and a named counterparty without those warnings", () => {
    const draft = draftMandateFromIntent(
      "₹50 per txn, ₹200 total, pay prov_compute_a for compute",
      NOW,
    );
    expect(draft.body.max_per_txn_paise).toBe(5_000);
    expect(draft.body.max_total_paise).toBe(20_000);
    expect(draft.body.allowed_counterparties).toContain("prov_compute_a");
    expect(draft.warnings).not.toContain("empty_allowlist");
    expect(draft.warnings).not.toContain("missing_caps");
    expect(canSignMandateDraft(draft.body, draft.warnings, { original: draft.body })).toBe(true);
  });

  it("readback is plain English and names empty allowlist", () => {
    const draft = draftMandateFromIntent("no limit, pay anyone", NOW);
    const text = readbackMandate(draft.body);
    expect(text.toLowerCase()).toContain("per transaction");
    expect(text).toMatch(/₹/);
    expect(text.toLowerCase()).toMatch(/allowlist|counterpart/);
    expect(text.toLowerCase()).toMatch(/none|empty|no counterpart/);
  });
});
