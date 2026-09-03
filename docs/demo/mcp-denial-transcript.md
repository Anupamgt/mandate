# MCP denial transcript (T-032 / FR-20…FR-23)

Command: `pnpm mcp:smoke`

This is an MCP client (`scripts/mcp-smoke.ts`, `@modelcontextprotocol/sdk`) talking to the proxy stdio server — the same entry as `pnpm dev:mcp` (`apps/proxy/src/mcp-stdio.ts`). MONEY_OUT on the Day-0 dump is `update_refund` (`apps/proxy/config/upstream-tools.json`). The gate runs `evaluate()` before any upstream Razorpay MCP forward.

Seeded mandate (`agent_demo`): `max_per_txn_paise = 10000`, `max_total_paise = 5000` (total below per-txn so the second call hits `CUM_CAP_EXCEEDED` without filling the ledger). Counterparties `prov_compute_a` / `razorpay`; tools `create_order` / `update_refund`.

## 1. Per-txn cap

Request (`tools/call`):

```json
{
  "name": "update_refund",
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
  "name": "update_refund",
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

Reproduce: `pnpm install` then `pnpm mcp:smoke`. Exits 0 only when both reason codes match. Not part of `pnpm check`.
