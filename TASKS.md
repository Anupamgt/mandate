# TASKS

Ordered by the release plan. One Cursor Agent session per line. Do not start P2 before all P0 are green.

Blocked items wait on test-mode keys in `.env` (`rzp_test_` only).

```
- [x] T-001  NFR-02   Monorepo scaffold (pnpm, strict TS, apps/* + packages/*)  [medium]
- [x] T-002  NFR-04   Prisma schema from ARCHITECTURE data model, SQLite         [medium]  depends: T-001
- [x] T-003  FR-12    Shared enums (reason codes, events) + Paise + exhaustiveness  [medium]  depends: T-001
- [x] T-004  FR-31    Day-0 rail decision → ARCHITECTURE.md                      [high]    rail: s2s_order
- [x] T-005  FR-20    Dump mcp.razorpay.com tools → apps/proxy/config/upstream-tools.json  [high]  42 tools
- [ ] T-006  FR-10/11 policy evaluate() + one test per reason code               [xhigh]   depends: T-003
- [ ] T-007  FR-01/02 mandate schema + Ed25519 sign/verify                       [xhigh]   depends: T-003
- [ ] T-008  FR-60/62 audit hash-chain + pnpm audit:verify                       [xhigh]   depends: T-003
```

## Tags

| Tag | Gate |
|---|---|
| `v0.0.1-docs` | This file set on `main` |
| `v0.1.0` | T-001–T-003 green **and** T-004/T-005 written (or explicitly blocked in ARCHITECTURE) |
| `v0.2.0` | Policy, audit, mandate, rails, resource server; one real test-mode settlement |
| `v0.3.0` | MCP proxy or REST-gate fallback; batch `false_allows = 0`; **reopen track choice** |
| `v0.4.0` | NL authoring, red-team, dashboard P1 |
| `v1.0.0` | README quickstart, video, fresh-clone test |

## Session rule

New chat per task. Branch `tNNN-fr…`. Conventional commit with the FR/NFR/RT id. Do not touch `packages/policy` or `packages/audit` without a TASKS line.
