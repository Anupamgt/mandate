import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isToolClass, TOOL_CLASSES } from "@mandate/shared";

type Dump = {
  tools: { name: string; class: string; comment?: string }[];
};

describe("FR-21 upstream tool classification", () => {
  const dump = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../config/upstream-tools.json"), "utf8"),
  ) as Dump;

  it("classifies every dumped tool", () => {
    expect(dump.tools.length).toBe(42);
    const names = new Set<string>();
    for (const tool of dump.tools) {
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect(isToolClass(tool.class), tool.name).toBe(true);
    }
  });

  it("keeps MONEY_OUT present and empty (no money-out tool in the dump)", () => {
    expect(TOOL_CLASSES).toContain("MONEY_OUT");
    expect(dump.tools.filter((t) => t.class === "MONEY_OUT")).toHaveLength(0);
    const revoke = dump.tools.find((t) => t.name === "revoke_token");
    expect(revoke?.class).toBe("READ");
    expect(revoke?.comment).toMatch(/non-money write/i);
  });
});
