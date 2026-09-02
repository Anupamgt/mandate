# Mandate

Bounded, revocable, audited spending authority for AI agents talking to Razorpay. **Test-mode only.** MIT.

## Problem

An agent with a payment tool can spend until someone notices. Caps live in the prompt. Revocation is “please stop.” There is no signed record of what was allowed, what was denied, or why.

Mandate puts those constraints **outside** the model: an operator-signed mandate, a deterministic `evaluate()`, reserve-then-settle, and a hash-chained audit log. The agent never holds Razorpay keys and never gets a `pay` tool.

## What it is

A local governance proxy (`apps/proxy`) between an operator / agent and Razorpay **test mode**.

- Operator issues or revokes an Ed25519-signed mandate (caps, window, tool + counterparty allowlists, step-up threshold), bound to one `agent_id`.
- Every spend goes through `evaluate()` — a pure function, no I/O, no LLM, no `Date.now()`. Unknown tools fail closed.
- On `ALLOW`, the proxy reserves, then pays on a rail (`MockRail` by default; `RazorpayTestRail` is `s2s_order` in test mode), then reconciles. Injected provisioning failure is reversed.
- Every attempt — allow, step-up, or deny — is an append-only audit row in a hash chain.

The **primary demo path** is the REST gate: the operator console calls `POST /spend/propose` (see [ARCHITECTURE.md](./ARCHITECTURE.md) §6). The proxy can also speak MCP (`stdio` and `POST /mcp`); that is not required for the walkthrough below.

Amounts are integer **paise** everywhere. Display them as rupees.

## Quickstart

Three commands. Node 20+, [pnpm](https://pnpm.io/) 11.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`.env.example` already sets `MANDATE_RAIL=mock`, so the walkthrough runs **without** Razorpay keys. To hit Razorpay test mode later, fill `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (`rzp_test_` only; never `rzp_live_`). Never commit `.env`.

Then open [http://127.0.0.1:43123](http://127.0.0.1:43123).

| Process | URL |
|---|---|
| Operator dashboard | http://127.0.0.1:43123 |
| Proxy REST | http://127.0.0.1:18787 · `POST /spend/propose` |
| Showcase 402 API | http://127.0.0.1:18788 |

## Demo script

Demo mandate (signed in the browser; private key never leaves the client): per-txn cap **10000 paise (₹100)**, cumulative **50000 paise (₹500)**, step-up above **8000 paise**, tools `create_order` / `update_refund`, counterparties `prov_compute_a` / `razorpay`.

1. Click **Issue demo mandate**.
2. **Propose spend** → Create order → chip **₹10 · should allow** (1000 paise) → `ALLOW`.
3. Amount **20000** paise → `PER_TXN_CAP_EXCEEDED`.
4. Tool **Create payout** (`create_payout`) → `TOOL_UNCLASSIFIED` (not on this test account; fail closed).
5. **Revoke**, then propose 1000 paise again → `MANDATE_REVOKED`.

Same gate from the shell after step 1 (agent is `agent_demo`):

```bash
curl -s http://127.0.0.1:18787/spend/propose -H "content-type: application/json" -d '{"agent_id":"agent_demo","tool":"create_order","counterparty_id":"prov_compute_a","amount_paise":1000,"purpose":"ok"}'
```

Optional evidence (not part of the three-command start):

```bash
pnpm test
pnpm batch
pnpm redteam
pnpm audit:verify packages/audit/fixtures/ok.json
```

`pnpm batch` rewrites `metrics.json` (`false_allows` must stay 0). `pnpm redteam` rewrites `REDTEAM.md`.

## Metrics

From committed `metrics.json` after `pnpm batch` (50 seeded MockRail attempts).

| Field | Value |
|---|---|
| total | 50 |
| allowed | 15 |
| step_ups | 5 |
| false_allows | **0** |
| false_denies | 0 |
| exceptions_raised | 3 |
| exceptions_resolved | 3 |
| paise_withheld | 220000 (₹2,200) |
| paise_reversed | 3000 (₹30) |
| residual_paise | 0 |
| decision_latency_p50_ms | 18 |
| decision_latency_p99_ms | 49 |

Denied by reason: `PER_TXN_CAP_EXCEEDED` 10 · `COUNTERPARTY_NOT_ALLOWED` 8 · `TOOL_UNCLASSIFIED` 5 · `TOOL_NOT_ALLOWED` 3 · `WINDOW_EXPIRED` 4.

Latency is end-to-end decision time in the batch harness (including SQLite), not in-process `evaluate()` alone.

## Limitations

**Placeholder — rewrite this section by hand before submission.** The bullets below are a factual floor, not a pitch.

- **Test-mode only.** No live money. Keys must start with `rzp_test_`. Live keys (`rzp_live_`) are out of scope.
- **No on-chain x402.** Showcase `HTTP 402` + proof verify uses Razorpay test mode or `MockRail`, not a blockchain settlement.
- **Audit is tamper-evident, not tamper-proof.** `pnpm audit:verify` walks a local hash chain. Logs are not externally anchored and are not a legal proof.
- Day-0 rail is Razorpay **s2s_order** (order + test payment; reverse = refund). This test account cannot create payouts (`GET /v1/payouts` → 400). `create_payout` is unclassified and denied.
- MCP to `mcp.razorpay.com` is implemented but is **not** the primary demo path; the walkthrough uses REST `POST /spend/propose`.
- Track (Open vs Track 01 Agentic Commerce) is **TBD** at submission. Do not read protocol names in [ARCHITECTURE.md](./ARCHITECTURE.md) §7 as claims of AP2 / x402 / UAP compliance.

See [ARCHITECTURE.md](./ARCHITECTURE.md) (non-goals §2, Day-0 §8) and [SECURITY.md](./SECURITY.md).

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

`PRD.md` and `DEV-PROCESS.md` win when present. Do not edit them; align code to them.

### Optional: MCP

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
