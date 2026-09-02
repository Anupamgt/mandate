import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asPaise } from "@mandate/shared";
import { RazorpayTestRail } from "./razorpay.js";

/** Parse KEY=VALUE lines the same way as scripts/day0-probe.mjs. No dotenv. */
function parseDotEnv(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return vars;
}

function loadLocalRazorpayTestKeys(): { keyId: string; keySecret: string } | null {
  const candidates = [
    join(process.cwd(), ".env"),
    join(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const vars = parseDotEnv(envPath);
    const keyId = vars.RAZORPAY_KEY_ID ?? "";
    const keySecret = vars.RAZORPAY_KEY_SECRET ?? "";
    if (!keyId.startsWith("rzp_test_") || keySecret.length === 0) return null;
    return { keyId, keySecret };
  }
  return null;
}

const liveKeys = loadLocalRazorpayTestKeys();

describe.skipIf(!liveKeys)("FR-31 live Razorpay test-mode s2s_order", () => {
  it(
    "pay() creates a real test-mode settlement with a non-empty externalRef",
    async () => {
      if (!liveKeys) throw new Error("unreachable: suite skipped without rzp_test_ keys");
      const rail = new RazorpayTestRail({
        keyId: liveKeys.keyId,
        keySecret: liveKeys.keySecret,
      });
      const amountPaise = asPaise(100);
      const quote = await rail.quote(amountPaise, "prov_t016");
      const paid = await rail.pay(quote, "mandate_t016", `t016_${Date.now()}`);
      expect(paid.railId).toBe("razorpay_s2s_order");
      expect(paid.amountPaise).toBe(amountPaise);
      expect(paid.externalRef.length).toBeGreaterThan(0);
      // Do not reverse: the settlement must remain visible in the Razorpay test dashboard.
    },
    60_000,
  );
});
