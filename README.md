# Mandate

Bounded, revocable, audited spending authority for AI agents talking to Razorpay. **Test-mode only.** MIT.

## The problem, shown

Razorpay's MCP server hands an agent full merchant-key power; "top up our API credits" can also refund or pay out whatever the key allows, and today only the prompt stops it.

```bash
curl -s http://127.0.0.1:18787/spend/propose -H "content-type: application/json" -d '{"agent_id":"agent_demo","tool":"create_order","counterparty_id":"prov_compute_a","amount_paise":20000,"purpose":"over cap"}'
```

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

## Why Open Track

Track 01's bar — every money action explainable, bounded, gated, with an audit trail and one failure handled — is exactly what Mandate builds, and we adopted it as our acceptance criteria on purpose. But Track 01 scores an agent that grows merchant revenue or makes a merchant transactable. Mandate is the authority layer *underneath* such agents: any spending agent — shopping, procurement, infra — points at the proxy and inherits signed, revocable, audited limits. The showcase domain is interchangeable; the layer is the product.

## Two minutes

```bash
git clone https://github.com/Anupamgt/mandate.git
cd mandate
pnpm i
pnpm dev
```

```bash
curl -s http://127.0.0.1:18787/spend/propose -H "content-type: application/json" -d '{"agent_id":"agent_demo","tool":"create_order","counterparty_id":"prov_compute_a","amount_paise":20000,"purpose":"over cap"}'
```

```bash
pnpm audit:verify packages/audit/fixtures/ok.json
```

## What it is

A governance proxy (`apps/proxy`) between an operator / agent and Razorpay **test mode**. The 42 upstream tools and their classes live in [`apps/proxy/config/upstream-tools.json`](./apps/proxy/config/upstream-tools.json); a name missing from that dump is unclassified and fail-closed (`TOOL_UNCLASSIFIED`).

- Operator issues or revokes an Ed25519-signed mandate (caps, window, tool + counterparty allowlists, step-up threshold), bound to one `agent_id`.
- Every spend goes through `evaluate()` — a pure function, no I/O, no LLM, no `Date.now()`.
- On `ALLOW`, the proxy reserves, then pays on a rail (`MockRail` by default; `RazorpayTestRail` is `s2s_order` in test mode), then reconciles. Injected provisioning failure is reversed.
- Every attempt — allow, step-up, or deny — is an append-only audit row in a hash chain.

The agent never holds Razorpay keys and never gets a `pay` tool. Amounts are integer **paise**. Field names follow AP2, the showcase speaks HTTP 402, and the mandate shape matches UAP — mapping, not a compliance claim: [ARCHITECTURE.md](./ARCHITECTURE.md) §7.

## Twenty minutes

From committed `metrics.json` after `pnpm batch` (50 seeded MockRail attempts).

| Field | Value |
|---|---|
| total | 50 |
| allowed | 15 |
| denied_by_reason | CUM_CAP_EXCEEDED 4 · PER_TXN_CAP_EXCEEDED 8 · COUNTERPARTY_NOT_ALLOWED 6 · TOOL_UNCLASSIFIED 5 · TOOL_NOT_ALLOWED 3 · WINDOW_EXPIRED 4 |
| step_ups | 5 |
| false_allows | **0** |
| false_denies | 0 |
| exceptions_raised | 3 |
| exceptions_resolved | 3 |
| paise_withheld | 182000 |
| paise_reversed | 3000 |
| residual_paise | 0 |
| decision_latency_p50_ms | 76.56369999999879 |
| decision_latency_p99_ms | 449.8716999999997 |

Latency is end-to-end decision time in the batch harness (including SQLite), not in-process `evaluate()` alone.

[REDTEAM.md](./REDTEAM.md) — RT-01…RT-10 all **PASS** (jailbreak vs cap, proof replay, parallel cap, bad HMAC, revoke-before-pay, tampered mandate, window expiry, exact counterparty, unclassified tool, audit tamper).

MCP denial: [docs/demo/mcp-denial-transcript.md](./docs/demo/mcp-denial-transcript.md) · `pnpm mcp:smoke`.

[ARCHITECTURE.md](./ARCHITECTURE.md). Tags: `v0.0.1-docs`, `v0.1.0`, `v0.3.0`.

## What broke

**Concurrent proposals beat the cumulative cap.** Parallel `POST /spend/propose` calls could all pass `evaluate()` before any settlement landed, so the live total exceeded `max_total_paise`. The fix is reserve-then-settle in one SQLite transaction (`apps/proxy/src/spend.ts`): the cumulative check and `Reservation` insert share `prisma.$transaction`. RT-03 fires 10 parallel ₹100 proposals at a ₹500 cap (`max_total_paise = 50000`) and ≤ 5 settle.

**The test account cannot create payouts** (`GET /v1/payouts` → 400). Day-0 fell back to `s2s_order`. The tool dump exposes no money-out tool, so `MONEY_OUT` is empty and enforced as such (`create_payout` → `TOOL_UNCLASSIFIED`); the gate is demonstrated on amount-bearing `MONEY_IN` tools.

**The MCP denial scene was nearly cut for demo reliability.** A live MCP client in a timed walkthrough is brittle. It was kept by committing `docs/demo/mcp-denial-transcript.md` and adding `pnpm mcp:smoke` to CI (`.github/workflows/check.yml`) so the denial is reproducible without a live client.

## Limitations

Read this before the metrics. Everything below is a deliberate scope cut, and each one is a real gap.

- **Test mode only.** Every rupee here is a Razorpay test-mode rupee. Keys must be `rzp_test_`; `rzp_live_` is out of scope and untested. Nothing in the policy or audit path knows which mode it is in, but we have not proven that with live money.
- **Payouts are not demonstrated.** The test account cannot create payouts (`GET /v1/payouts` → 400). Day-0 fell back to `s2s_order`. The tool dump exposes no money-out tool, so `MONEY_OUT` is empty and enforced as such (`create_payout` → `TOOL_UNCLASSIFIED`); the gate is demonstrated on amount-bearing `MONEY_IN` tools.
- **Mandates are signed JSON, not verifiable credentials.** Ed25519 over canonical JSON, field names aligned with AP2's Intent Mandate. That is not W3C VC compliance, and none of the protocol names in ARCHITECTURE.md §7 are compliance claims — they are a mapping of our components onto theirs.
- **One operator key.** A single principal signs every mandate and every step-up approval. There are no delegation chains, no multi-party approval, and no key rotation. Compromise that key and the gate is still deterministic, but it is enforcing an attacker's mandate.
- **The audit log is tamper-evident, not tamper-proof.** `pnpm audit:verify` walks a local SHA-256 hash chain and finds the first edited row. The chain head is not anchored anywhere external, so an attacker with write access to the database and the code can rewrite history consistently. It is evidence, not proof.
- **No dispute or chargeback flow.** Reconciliation covers "paid but not provisioned" and reverses it. A counterparty who disputes a settlement has no path through this system.
- **x402 is an interface, not a rail.** The `Rail` abstraction has a `MockRail` for tests; there is no on-chain settlement and we have not run against a real x402 facilitator.
- **Natural-language drafting is a convenience, not a control.** The model drafts a mandate; the operator reads the plain-English readback and signs. If the operator signs without reading, the model's interpretation becomes the authority. Nothing in the policy engine reads free text.
- **Single process, single SQLite file.** Reserve-then-settle holds under concurrent proposals within one process (RT-03). We have not tested it across multiple proxy instances.

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

`PRD.md` and `DEV-PROCESS.md` win when present. Do not edit them; align code to them. See [SECURITY.md](./SECURITY.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

## Demo script

Demo mandate (signed in the browser; private key never leaves the client): per-txn cap **10000 paise (₹100)**, cumulative **50000 paise (₹500)**, step-up above **8000 paise**, tools `create_order` / `update_refund`, counterparties `prov_compute_a` / `razorpay`.

1. Click **Issue demo mandate**.
2. **Propose spend** → Create order → chip **₹10 · should allow** (1000 paise) → `ALLOW`.
3. Amount **20000** paise → `PER_TXN_CAP_EXCEEDED`.
4. Tool **Create payout** (`create_payout`) → `TOOL_UNCLASSIFIED` (not on this test account; fail closed).
5. **Revoke**, then propose 1000 paise again → `MANDATE_REVOKED`.

Walkthrough video: [docs/demo/VIDEO.md](./docs/demo/VIDEO.md).

## MCP proxy

REST is the scripted walkthrough (`POST /spend/propose`). MCP is the same gate for any MCP client (`stdio` via `pnpm dev:mcp`, or `POST /mcp`). Transcript: [docs/demo/mcp-denial-transcript.md](./docs/demo/mcp-denial-transcript.md). Reproduce non-interactively: `pnpm mcp:smoke` (needs a Prisma SQLite DB; not part of `pnpm check`).

Stdio (Cursor / Claude Desktop), after `pnpm install`:

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

HTTP: `POST http://127.0.0.1:18787/mcp` with `X-Mandate-Agent-Id: agent_demo`. Missing `agent_id` → `NO_MANDATE`. Unclassified tool names → `TOOL_UNCLASSIFIED`.
