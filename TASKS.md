# TASKS

Ordered by the release plan. One Cursor Agent session per line. Do not start P2 before all P0 are green.

```
- [x] T-001  NFR-02   Monorepo scaffold (pnpm, strict TS, apps/* + packages/*)
- [x] T-002  NFR-04   Prisma schema from ARCHITECTURE data model, SQLite
- [x] T-003  FR-12    Shared enums (reason codes, events) + Paise + exhaustiveness
- [x] T-004  FR-31    Day-0 rail decision → ARCHITECTURE.md  (s2s_order)
- [x] T-005  FR-20    Dump mcp.razorpay.com tools → upstream-tools.json (42 tools)
- [x] T-006  FR-10/11 policy evaluate() + one test per reason code
- [x] T-007  FR-01/02 mandate schema + Ed25519 sign/verify
- [x] T-008  FR-60/62 audit hash-chain + pnpm audit:verify
- [x] T-009  FR-30/33 Rail + MockRail + RazorpayTestRail
- [x] T-010  FR-01/03 REST issue/revoke/get remaining budget
- [x] T-011  FR-13    reserve-then-settle (parallel cap)
- [x] T-012  FR-40-42 resource-server 402 + proof replay + HMAC
- [x] T-013  FR-50-51 reconciler reverse / EXCEPTION_UNRESOLVED
- [x] T-015  FR-80-81 pnpm batch → metrics.json false_allows=0
- [x] T-016  FR-31    one live rzp_test_ settlement
- [x] T-017  FR-20/21/22/23 MCP proxy stdio + streamable HTTP
- [x] T-018  FR-82    pnpm redteam → REDTEAM.md
- [x] T-019  FR-70    mandates list
- [x] T-020  FR-71    SSE checks in live stream
- [x] T-021  FR-73    step-up inbox
- [x] T-022  FR-05/74 NL authoring
- [x] T-023  FR-52/72 Explain narrative
- [x] T-024  FR-44    rationale visible
- [x] T-025  FR-82    re-run pnpm redteam + pnpm check before v0.4.0
- [x] T-026  FR-83    README draft (human rewrites limitations)
- [ ] T-027           video timing only (150 wpm, PRD §12)
- [x] T-028           fresh clone < 5 min then v1.0.0
```

## Tags

| Tag | Status | Gate |
|---|---|---|
| `v0.0.1-docs` | pushed | This file set on `main` |
| `v0.1.0` | pushed | T-001–T-003 green **and** T-004/T-005 written (or explicitly blocked in ARCHITECTURE) |
| `v0.2.0` | skipped | Policy, audit, mandate, rails, resource server; one real test-mode settlement. Skipped because deterministic core and MCP landed in the same push. |
| `v0.3.0` | pushed | MCP proxy or REST-gate fallback; batch `false_allows = 0`; **reopen track choice** |
| `v0.4.0` | pending | NL authoring, red-team, dashboard P1 |
| `v1.0.0` | pending | README quickstart, video, fresh-clone test |

**Open Track (Track 05).** Track 01 is an agent that *shops*; Mandate is the *authority layer* any spending agent — shopping, procurement, infra — plugs into, rail-agnostic and protocol-mapped (AP2 / x402 / UAP); the showcase domain is interchangeable.
