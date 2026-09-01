/**
 * Day-0 rail + MCP probe. Reads .env. Prints status codes and names only — never keys.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const vars = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const keyId = vars.RAZORPAY_KEY_ID ?? "";
const secret = vars.RAZORPAY_KEY_SECRET ?? "";
const mcpUrl = vars.RAZORPAY_MCP_URL ?? "https://mcp.razorpay.com/mcp";

if (!keyId.startsWith("rzp_test_") || !secret) {
  console.error("ABORT: need rzp_test_ key id and non-empty secret in .env");
  process.exit(1);
}

const basic = Buffer.from(`${keyId}:${secret}`).toString("base64");
const auth = `Basic ${basic}`;

async function rzp(path) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { Authorization: auth },
  });
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const err =
    parsed?.error?.description ??
    parsed?.error?.code ??
    (body.length > 180 ? body.slice(0, 180) : body);
  return { status: res.status, err: res.ok ? null : String(err) };
}

const rails = {
  payments: await rzp("/payments?count=1"),
  orders: await rzp("/orders?count=1"),
  refunds: await rzp("/refunds?count=1"),
  payouts: await rzp("/payouts?count=1"),
  contacts: await rzp("/contacts?count=1"),
  fund_accounts: await rzp("/fund_accounts?count=1"),
};

let winner = "none";
if (rails.payouts.status === 200 || rails.contacts.status === 200) {
  winner = "razorpayx_payout";
} else if (rails.orders.status === 200) {
  winner = "s2s_order";
} else if (rails.payments.status === 200) {
  winner = "provider_order_refund";
}

async function mcpTools() {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const init = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "mandate-day0", version: "0.0.1" },
      },
    }),
  });
  const initText = await init.text();
  const session = init.headers.get("mcp-session-id") ?? init.headers.get("Mcp-Session-Id");

  const notifyHeaders = { ...headers };
  if (session) notifyHeaders["mcp-session-id"] = session;
  await fetch(mcpUrl, {
    method: "POST",
    headers: notifyHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  const list = await fetch(mcpUrl, {
    method: "POST",
    headers: notifyHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const listText = await list.text();

  const extractJson = (text) => {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    const raw = dataLine ? dataLine.slice(5).trim() : text;
    try {
      return JSON.parse(raw);
    } catch {
      return { parseError: raw.slice(0, 300) };
    }
  };

  const initJson = extractJson(initText);
  const listJson = extractJson(listText);
  const tools = (listJson?.result?.tools ?? []).map((t) => ({
    name: t.name,
    description: (t.description ?? "").slice(0, 160),
  }));

  return {
    initStatus: init.status,
    listStatus: list.status,
    session: Boolean(session),
    initError: initJson?.error?.message ?? initJson?.parseError ?? null,
    listError: listJson?.error?.message ?? listJson?.parseError ?? null,
    tools,
  };
}

const mcp = await mcpTools();

const out = {
  probedAt: new Date().toISOString(),
  keyPrefix: "rzp_test_",
  winner,
  rails,
  mcp: {
    url: mcpUrl,
    initStatus: mcp.initStatus,
    listStatus: mcp.listStatus,
    session: mcp.session,
    initError: mcp.initError,
    listError: mcp.listError,
    toolCount: mcp.tools.length,
    toolNames: mcp.tools.map((t) => t.name),
  },
};

mkdirSync(join(root, "apps/proxy/config"), { recursive: true });
if (mcp.tools.length) {
  writeFileSync(
    join(root, "apps/proxy/config/upstream-tools.json"),
    JSON.stringify({ source: mcpUrl, dumpedAt: out.probedAt, tools: mcp.tools }, null, 2) + "\n",
  );
}
writeFileSync(join(root, "apps/proxy/config/day0-probe.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
