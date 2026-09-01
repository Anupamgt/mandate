# Mandate

Bounded, revocable, audited spending authority for AI agents talking to Razorpay.

An MCP client never holds Razorpay keys and never gets a `pay` tool. Every money-moving call hits a pure `evaluate()` against an Ed25519-signed mandate. Denials are structured. Settlements are reserved first, then paid, then reconciled. The audit log is a hash chain.

## Quickstart

```bash
pnpm install
cp .env.example .env          # optional: add rzp_test_ keys
pnpm dev
```

Then open the operator console at [http://127.0.0.1:43123](http://127.0.0.1:43123).

1. Click **Issue demo mandate** (Ed25519 key stays in this browser).
2. Propose ₹10 (1000 paise) — should `ALLOW`.
3. Propose 20000 paise — `PER_TXN_CAP_EXCEEDED`.
4. Set tool to `create_payout` — `TOOL_UNCLASSIFIED`.
5. Revoke, then propose again — `MANDATE_REVOKED`.

| Process | URL |
|---|---|
| Operator dashboard | http://127.0.0.1:43123 |
| Proxy REST + MCP | http://127.0.0.1:18787 · `POST /mcp` |
| Showcase 402 API | http://127.0.0.1:18788 |

## MCP (T-017)

The proxy is an MCP server on **stdio** and **streamable HTTP**.

- Re-exposes the 42 `mcp.razorpay.com` tools 1:1, plus `mandate.status`.
- `READ` tools pass through and write an audit row.
- `MONEY_*` tools become a `SpendRequest` and run `evaluate()`.
- Missing `agent_id` (header `X-Mandate-Agent-Id`, query, initialize `_meta`, or `MANDATE_AGENT_ID`) → `NO_MANDATE`.
- A name that is not in `apps/proxy/config/upstream-tools.json` → `TOOL_UNCLASSIFIED`.

Stdio (Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "mandate": {
      "command": "pnpm",
      "args": ["--filter", "@mandate/proxy", "mcp"],
      "env": { "MANDATE_AGENT_ID": "agent_demo" }
    }
  }
}
```

HTTP: `POST http://127.0.0.1:18787/mcp` with `X-Mandate-Agent-Id: agent_demo`.

## Evidence

```bash
pnpm test
pnpm batch      # writes metrics.json; false_allows must be 0
pnpm redteam    # writes REDTEAM.md
pnpm audit:verify packages/audit/fixtures/ok.json
```

## Layout

```
apps/proxy              REST + MCP governance proxy
apps/web                Next.js 15 operator console
apps/resource-server    402-gated compute / llm showcase
apps/agent              scripted batch + red-team drivers
packages/policy         evaluate() — no I/O, no Date.now()
packages/mandate        schema + Ed25519
packages/audit          hash chain + verify CLI
packages/rails          MockRail + RazorpayTestRail (s2s_order)
packages/shared         reason codes, events, Paise
```

Test-mode only. MIT. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [SECURITY.md](./SECURITY.md).
