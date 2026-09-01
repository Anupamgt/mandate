/**
 * Showcase agent tools (FR-43). Payment executes inside the proxy after ALLOW.
 * There is no `pay` tool.
 */
export const AGENT_TOOLS = [
  "list_resources",
  "propose_spend",
  "fetch_resource",
  "check_mandate",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];
