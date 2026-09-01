import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "./index.js";

describe("FR-43 agent tools", () => {
  it("does not include a pay tool", () => {
    expect(AGENT_TOOLS).not.toContain("pay");
    expect([...AGENT_TOOLS].sort()).toEqual(
      ["check_mandate", "fetch_resource", "list_resources", "propose_spend"].sort(),
    );
  });
});
