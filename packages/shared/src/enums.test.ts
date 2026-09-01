import { describe, expect, it } from "vitest";
import { asPaise } from "./paise.js";
import { EVENT_TYPES, eventTypeLabel, isEventType } from "./event-types.js";
import { REASON_CODES, isReasonCode, reasonCodeLabel } from "./reason-codes.js";
import { TOOL_CLASSES, isToolClass } from "./tool-class.js";

describe("FR-14 Paise", () => {
  it("accepts non-negative integers", () => {
    expect(asPaise(0)).toBe(0);
    expect(asPaise(150000)).toBe(150000);
  });

  it("rejects floats", () => {
    expect(() => asPaise(1.5)).toThrow(/integer/);
  });

  it("rejects negatives", () => {
    expect(() => asPaise(-1)).toThrow(/non-negative/);
  });
});

describe("FR-12 reason codes", () => {
  it("is a closed enum of 15 codes", () => {
    expect(REASON_CODES).toHaveLength(15);
    expect(new Set(REASON_CODES).size).toBe(15);
  });

  it("labels every code (exhaustiveness)", () => {
    for (const code of REASON_CODES) {
      expect(reasonCodeLabel(code).length).toBeGreaterThan(0);
      expect(isReasonCode(code)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isReasonCode("BYPASS")).toBe(false);
    expect(isReasonCode("ALLOW ")).toBe(false);
  });
});

describe("FR-61 event types", () => {
  it("is a closed enum of 16 events", () => {
    expect(EVENT_TYPES).toHaveLength(16);
    expect(new Set(EVENT_TYPES).size).toBe(16);
  });

  it("labels every event (exhaustiveness)", () => {
    for (const type of EVENT_TYPES) {
      expect(eventTypeLabel(type).length).toBeGreaterThan(0);
      expect(isEventType(type)).toBe(true);
    }
  });
});

describe("tool class", () => {
  it("is MONEY_OUT | MONEY_IN | READ", () => {
    expect(TOOL_CLASSES).toEqual(["MONEY_OUT", "MONEY_IN", "READ"]);
    expect(isToolClass("READ")).toBe(true);
    expect(isToolClass("BYPASS")).toBe(false);
  });
});
