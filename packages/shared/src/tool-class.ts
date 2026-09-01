export const TOOL_CLASSES = ["MONEY_OUT", "MONEY_IN", "READ"] as const;

export type ToolClass = (typeof TOOL_CLASSES)[number];

export function isToolClass(value: string): value is ToolClass {
  return (TOOL_CLASSES as readonly string[]).includes(value);
}
