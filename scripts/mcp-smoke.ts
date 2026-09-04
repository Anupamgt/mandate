/**
 * T-032 / T-041 — MCP client smoke (FR-20…FR-23).
 * Spawns the same stdio entry as `pnpm dev:mcp`, lists tools, then gates
 * amount-bearing MONEY_IN over cap and an unclassified payout name.
 */
import {
  createSmokeClient,
  parseToolDenial,
  pickSmokeTool,
  seedSmokeMandate,
  SMOKE_CAPS,
  SMOKE_UNCLASSIFIED_TOOL,
} from "../apps/proxy/src/mcp/smoke-support.js";

const { databaseUrl, publicKeyHex } = await seedSmokeMandate();
const { client, transport } = createSmokeClient({ databaseUrl, publicKeyHex });
await client.connect(transport);

const listed = await client.listTools();
const names = listed.tools.map((t) => t.name);
const smokeTool = pickSmokeTool(names);
if (listed.tools.length < 2) {
  throw new Error(`tools/list too short (got ${listed.tools.length})`);
}

async function deny(name: string, amount_paise: number, expect: string) {
  const args = { amount_paise, counterparty_id: "prov_compute_a" };
  const result = await client.callTool({ name, arguments: args });
  const body = parseToolDenial(result);
  console.log(JSON.stringify({ request: { name, arguments: args }, response: body }));
  if (body.decision !== "DENY" || body.reason_code !== expect || !Array.isArray(body.checks)) {
    throw new Error(`expected DENY/${expect}, got ${JSON.stringify(body)}`);
  }
}

await deny(smokeTool, SMOKE_CAPS.per_txn_over, "PER_TXN_CAP_EXCEEDED");
await deny(smokeTool, SMOKE_CAPS.cum_over, "CUM_CAP_EXCEEDED");
await deny(SMOKE_UNCLASSIFIED_TOOL, SMOKE_CAPS.per_txn_over, "TOOL_UNCLASSIFIED");
await client.close();
console.log("mcp:smoke ok");
