import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BATCH_TOTAL, CUM_CAP_AMOUNT_PAISE, CUM_CAP_MAX_TOTAL_PAISE, expectedReason } from "./batch-seed.js";
import { runBatch } from "./batch.js";

describe("FR-80 FR-81 FR-13 batch cumulative cap", () => {
  it("seed is 50 attempts and includes a CUM_CAP_EXCEEDED group", () => {
    const reasons = Array.from({ length: BATCH_TOTAL }, (_, i) => expectedReason(i));
    expect(reasons).toHaveLength(50);
    const cum = reasons.filter((r) => r === "CUM_CAP_EXCEEDED").length;
    expect(cum).toBeGreaterThanOrEqual(4);
    const allowsBeforeCap = reasons.filter((r) => r === "ALLOW").length;
    expect(allowsBeforeCap).toBeGreaterThan(0);
    expect(CUM_CAP_MAX_TOTAL_PAISE).toBe(CUM_CAP_AMOUNT_PAISE * 4);
  });

  it("pnpm batch metrics: CUM_CAP_EXCEEDED ≥ 4, false_allows=0, residual=0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mandate-batch-"));
    const outPath = join(dir, "metrics.json");
    const m = await runBatch(outPath);
    const written = JSON.parse(readFileSync(outPath, "utf8")) as typeof m;

    expect(m.total).toBe(50);
    expect(m.false_allows).toBe(0);
    expect(m.false_denies).toBe(0);
    expect(m.residual_paise).toBe(0);
    expect(m.exceptions_raised).toBe(m.exceptions_resolved);
    expect(m.denied_by_reason.CUM_CAP_EXCEEDED ?? 0).toBeGreaterThanOrEqual(4);

    expect(written.total).toBe(m.total);
    expect(written.denied_by_reason.CUM_CAP_EXCEEDED).toBe(m.denied_by_reason.CUM_CAP_EXCEEDED);
    expect(written).toMatchObject({
      false_allows: 0,
      false_denies: 0,
      residual_paise: 0,
    });
  }, 60_000);
});
