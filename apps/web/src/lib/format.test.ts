import { describe, expect, it } from "vitest";
import { budgetPercent, formatRupeesFromPaise, parsePaiseInput, usedBudgetPaise, usedBudgetPercent } from "./format";

describe("FR-14 display paise as rupees", () => {
  it("formats integer paise as rupees without floats", () => {
    expect(formatRupeesFromPaise(0)).toBe("₹0.00");
    expect(formatRupeesFromPaise(1)).toBe("₹0.01");
    expect(formatRupeesFromPaise(100)).toBe("₹1.00");
    expect(formatRupeesFromPaise(10_000)).toBe("₹100.00");
    expect(formatRupeesFromPaise(12_345)).toBe("₹123.45");
  });
});

describe("integer paise POST", () => {
  it("accepts integer paise strings and rejects floats", () => {
    expect(parsePaiseInput("1000")).toBe(1000);
    expect(parsePaiseInput("10.00")).toBeNull();
    expect(parsePaiseInput("")).toBeNull();
  });
});

describe("FR-70 remaining-budget bar (settled + reserved / total)", () => {
  it("treats used paise as max_total minus remaining (settled + reserved)", () => {
    // remaining_paise from GET /mandates is max_total - settled - reserved
    expect(usedBudgetPaise(30_000, 50_000)).toBe(20_000);
    expect(usedBudgetPercent(30_000, 50_000)).toBe(40);
    expect(budgetPercent(30_000, 50_000)).toBe(60);
  });

  it("is 100% used when remaining is 0", () => {
    expect(usedBudgetPaise(0, 50_000)).toBe(50_000);
    expect(usedBudgetPercent(0, 50_000)).toBe(100);
  });

  it("clamps a zero total to 0%", () => {
    expect(usedBudgetPercent(0, 0)).toBe(0);
    expect(usedBudgetPaise(0, 0)).toBe(0);
  });

  it("uses integer arithmetic only", () => {
    expect(usedBudgetPercent(1, 3)).toBe(66);
  });
});
