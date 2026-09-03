import { afterEach, describe, expect, it } from "vitest";
import { runAfterReserveHook } from "./spend.js";

describe("MANDATE_TEST_HOOKS after-reserve hook", () => {
  const prev = process.env.MANDATE_TEST_HOOKS;

  afterEach(() => {
    if (prev === undefined) delete process.env.MANDATE_TEST_HOOKS;
    else process.env.MANDATE_TEST_HOOKS = prev;
  });

  it("is a no-op when MANDATE_TEST_HOOKS is unset", async () => {
    delete process.env.MANDATE_TEST_HOOKS;
    let called = 0;
    await runAfterReserveHook(async () => {
      called += 1;
    }, { mandateId: "m", spendRequestId: "s" });
    expect(called).toBe(0);
  });

  it("runs when MANDATE_TEST_HOOKS=1", async () => {
    process.env.MANDATE_TEST_HOOKS = "1";
    let called = 0;
    await runAfterReserveHook(async () => {
      called += 1;
    }, { mandateId: "m", spendRequestId: "s" });
    expect(called).toBe(1);
  });
});
