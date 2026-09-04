# MCP denial transcript (T-032 / T-041 / FR-20…FR-23)

The Day-0 42-tool dump has no MONEY_OUT tools.

Command: `pnpm mcp:smoke`

This is an MCP client (`scripts/mcp-smoke.ts`, `@modelcontextprotocol/sdk`) talking to the proxy stdio server — the same entry as `pnpm dev:mcp` (`apps/proxy/src/mcp-stdio.ts`). `MONEY_OUT` is present as a class and empty; the gate is demonstrated on amount-bearing `MONEY_IN` (`create_payment_link`) and on unclassified `create_payout` (`TOOL_UNCLASSIFIED`). `evaluate()` runs before any upstream Razorpay MCP forward.

Seeded mandate (`agent_demo`): `max_per_txn_paise = 10000`, `max_total_paise = 5000` (total below per-txn so the second call hits `CUM_CAP_EXCEEDED` without filling the ledger). Counterparties `prov_compute_a` / `razorpay`; tools `create_order` / `create_payment_link` / `capture_payment`.

## 1. Per-txn cap

Request (`tools/call`):

```json
{
  "name": "create_payment_link",
  "arguments": {
    "amount_paise": 20000,
    "counterparty_id": "prov_compute_a"
  }
}
```

Response (tool result text, parsed):

```json
{
  "decision": "DENY",
  "reason_code": "PER_TXN_CAP_EXCEEDED",
  "checks": [
    "signature:pass",
    "status:pass",
    "window:pass",
    "agent:pass",
    "tool:pass",
    "counterparty:pass",
    "per_txn:exceeded"
  ]
}
```

## 2. Cumulative cap

Request (`tools/call`):

```json
{
  "name": "create_payment_link",
  "arguments": {
    "amount_paise": 6000,
    "counterparty_id": "prov_compute_a"
  }
}
```

Response (tool result text, parsed):

```json
{
  "decision": "DENY",
  "reason_code": "CUM_CAP_EXCEEDED",
  "checks": [
    "signature:pass",
    "status:pass",
    "window:pass",
    "agent:pass",
    "tool:pass",
    "counterparty:pass",
    "per_txn:pass",
    "cumulative:exceeded"
  ]
}
```

## 3. Unclassified payout

Request (`tools/call`):

```json
{
  "name": "create_payout",
  "arguments": {
    "amount_paise": 20000,
    "counterparty_id": "prov_compute_a"
  }
}
```

Response (tool result text, parsed):

```json
{
  "decision": "DENY",
  "reason_code": "TOOL_UNCLASSIFIED",
  "checks": [
    "tool_class:unclassified"
  ]
}
```

Reproduce: `pnpm install` then `pnpm mcp:smoke`. Exits 0 only when all three reason codes match. Not part of `pnpm check`.
