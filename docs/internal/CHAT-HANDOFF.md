# Mandate — chat handoff

Use this file as the entire prior-conversation memory. **PRD.md wins over comments.** If `PRD.md` / `DEV-PROCESS.md` are missing from the clone, use `ARCHITECTURE.md` §10 (requirement tables) and `.cursor/rules/*`.

New chat kickoff:

```
Read CHAT-HANDOFF.md, TASKS.md, ARCHITECTURE.md (header + §8 + §10), FRIDAY-NEXT.md.
git status; git log -8 --oneline.
Do not implement yet. Confirm the next T-id. List files. Stop.
```

---

## What it is

**Mandate** — Razorpay AI Buildathon 2026, Track 05 Open Track. Governance proxy between MCP agents and Razorpay: signed/revocable mandates, deterministic `evaluate()`, hash-chained audit, reserve-then-settle, 402 showcase + reversal.

- Local: `C:\Users\sharm\Projects\mandate`
- GitHub: https://github.com/Anupamgt/mandate (public, MIT, author **Anupam Sharma**)
- PRD owner line: Mohit (leave it)
- License/README author: Anupam Sharma
- Test-mode only. Never commit `.env`. Keys `rzp_test_` only. Never print secrets.

## Locked decisions

| Item | Decision |
|---|---|
| Product name | Mandate. Repo only `Anupamgt/mandate`. |
| Track | **TBD** until submission form (Open vs Track 01). Reopen at `v0.3.0` — tag exists locally/on origin as `ARCHITECTURE` status `v0.3.0`; form still TBD. |
| Day-0 rail | **`s2s_order`**. Payouts REST 400. `pay` = order + test payment; `reverse` = refund. |
| MCP dump | `https://mcp.razorpay.com/mcp`, **42 tools**, no `create_payout`. Classes in `apps/proxy/config/upstream-tools.json`. |
| Policy | `evaluate()` **verifies Ed25519 every call** (FR-04). No cached `signatureValid`. Check order FR-11. `RATE_LIMITED` is proxy SEC-08, not policy. |
| Fail closed | Unknown tool / event / reason → DENY. Agent never gets a `pay` tool. Payment only inside proxy after ALLOW. |
| P2 | Do not start FR-06, FR-24, FR-75 until all P0 green. FR-75 fallback: `pnpm audit:verify` + screenshot. |

## Stack

pnpm monorepo, TS strict, Hono (`apps/proxy`, `apps/resource-server`), Next.js 15 (`apps/web/src/app`), Prisma+SQLite (`packages/db`), zod, vitest, `@noble/ed25519`, MCP SDK.

Ports (README): dashboard **43123**, proxy **18787** `POST /mcp`, resource-server **18788**.

## Git (as of 2026-09-02)

`main` = `origin/main` = **`8bd6452`** `merge: T-022 FR-05 FR-74 NL authoring into local main`

Tags: `v0.0.1-docs`, `v0.1.0`. **No `v0.2.0` / `v0.4.0` / `v1.0.0` tags.** ARCHITECTURE header says tag `v0.3.0` (product state, not necessarily a git tag — confirm with `git tag`).

Merged locally onto main:

- `feat(web): FR-70 mandates list remaining-budget revoke`
- `feat(proxy): FR-73 SEC-05 step-up approval inbox`
- `feat(mandate): FR-05 FR-74 NL draft with empty-allowlist warning`

Dirty: `REDTEAM.md`, `metrics.json`, untracked `FRIDAY-NEXT.md`.

Do not push unless asked. Never `--force` to main.

## What is built (do not rebuild)

**P0 core:** monorepo, Prisma, shared enums/`Paise`, `evaluate()` 100% on `evaluate.ts`, mandate Ed25519, audit hash chain + `pnpm audit:verify`, MockRail + RazorpayTestRail, REST issue/revoke/get remaining, reserve-then-settle (RT-03), 402 + proof verify + HMAC, reconciler reverse / `EXCEPTION_UNRESOLVED`, `pnpm batch` (`false_allows: 0`), MCP proxy stdio + `POST /mcp` (T-017).

**P1 dashboard (this week):**

| Path | FR |
|---|---|
| `apps/web/src/app/page.tsx` | FR-70 list + budget bar + revoke; EventSource `/events` (FR-71 may already be partial) |
| `apps/web/src/app/approvals/page.tsx` | FR-73 inbox; `POST /spend/:id/approve` signed (SEC-05) |
| `apps/web/src/app/mandates/new/page.tsx` | FR-05/74 NL draft + form + readback; LLM never signs |
| `apps/proxy/src/create-app.ts` | `/mandates/draft`, `/spend/:id/approve`, `/exceptions`, `/events` |

**Evidence:** `metrics.json` (`false_allows: 0`, total 50). `REDTEAM.md` RT-01..RT-10 **PASS**.

## Policy contract (do not change signature)

```
evaluate(req, mandate, ledgerView, nowMs) → { decision, reason_code, checks[] }
```

Pure. No I/O, no LLM, no `Date.now()`. Mandate null → `NO_MANDATE` before FR-11. Unclassified tool → `TOOL_UNCLASSIFIED` in the tool-allowed slot.

After `v0.2.0`-era core: any edit to `packages/policy` or `packages/audit` needs a `TASKS.md` line + reason. Unrelated hunks → revert.

## Next work

`TASKS.md` still shows T-016 and a lumped T-019 open — **T-019/021/022 code is on main**; update TASKS when you touch it.

Ordered remaining (full paste prompts: `FRIDAY-NEXT.md`):

1. **T-016 FR-31** — one live `rzp_test_` settlement (integration; skip CI without keys; never print secrets)
2. **T-020 FR-71** — only if SSE is incomplete vs PRD (decision, reason, checks live)
3. **T-023 FR-52/72** — Explain narrative on exceptions (read-only; cite `seq`)
4. **T-024 FR-44** — rationale visible, never into `evaluate()`
5. **T-025** — re-run `pnpm redteam` + `pnpm check`; human tags `v0.4.0`
6. **T-026** — README draft; **human** writes limitations
7. **T-027** — video word-count only (150 wpm, PRD §12); human records
8. **T-028** — fresh clone &lt; 5 min; human tags `v1.0.0` and submits

Human-owned: limitations, pitch, track checkbox, push.

## Session rules (DEV-PROCESS)

- One FR per chat. Branch `tNNN-fr…`. Conventional commit with FR id.
- Plan ≤ 8 bullets, wait for OK on policy/audit.
- Test-first. `pnpm check` must be green (typecheck + test + batch + redteam).
- PowerShell: no `&&`; use `; if ($LASTEXITCODE -eq 0) { … }`.
- No new deps without listing reason and waiting.
- Display paise as rupees; POST integers. Signing client-side; proxy has public key only (SEC-02).

## Commands

`pnpm dev` · `pnpm test` · `pnpm batch` · `pnpm redteam` · `pnpm audit:verify` · `pnpm check`
