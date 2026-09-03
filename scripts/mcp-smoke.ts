/**
 * T-032 — MCP client smoke (FR-20…FR-23).
 * Spawns the same stdio entry as `pnpm dev:mcp`, lists tools, then calls MONEY_OUT over cap.
 */
import {
  createSmokeClient,
  parseToolDenial,
  seedSmokeMandate,
  SMOKE_CAPS,
  SMOKE_TOOL,
} from "../apps/proxy/src/mcp/smoke-support.js";

const { databaseUrl, publicKeyHex } = await seedSmokeMandate();
const { client, transport } = createSmokeClient({ databaseUrl, publicKeyHex });
await client.connect(transport);

const listed = await client.listTools();
if (!listed.tools.some((t) => t.name === SMOKE_TOOL) || listed.tools.length < 2) {
  throw new Error(`tools/list missing ${SMOKE_TOOL} (got ${listed.tools.length})`);
}

async function deny(amount_paise: number, expect: string) {
  const args = { amount_paise, counterparty_id: "prov_compute_a" };
  const result = await client.callTool({ name: SMOKE_TOOL, arguments: args });
  const body = parseToolDenial(result);
  console.log(JSON.stringify({ request: { name: SMOKE_TOOL, arguments: args }, response: body }));
  if (body.decision !== "DENY" || body.reason_code !== expect || !Array.isArray(body.checks)) {
    throw new Error(`expected DENY/${expect}, got ${JSON.stringify(body)}`);
  }
}

await deny(SMOKE_CAPS.per_txn_over, "PER_TXN_CAP_EXCEEDED");
await deny(SMOKE_CAPS.cum_over, "CUM_CAP_EXCEEDED");
await client.close();
console.log("mcp:smoke ok");
