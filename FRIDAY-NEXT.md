# Friday next chats — Mandate

Paste this file into a **new** Cursor Agent chat (`@FRIDAY-NEXT.md`). One FR per chat. **PRD.md wins** over comments. Do not touch `packages/policy` or `packages/audit` without a new `TASKS.md` line and a reason.

Repo: `C:\Users\sharm\Projects\mandate` · GitHub is behind local until you push.

## Kickoff (paste first; do not implement)

```
Read FRIDAY-NEXT.md and TASKS.md. Run git status and git log -5 --oneline.

Do not implement yet. Confirm which of T-016 / T-020 / T-023 is actually next given what is already on main. List files you would touch. Stop.
```

## Already done — do not rebuild

- T-001–T-015, T-017, T-018 (see `TASKS.md`)
- Batch: `pnpm batch` → `metrics.json` with `false_allows = 0`
- Red-team: `pnpm redteam` → `REDTEAM.md` (still **re-run** at T-025 before tagging `v0.4.0`)
- MCP proxy T-017 is checked on current `TASKS.md`
- T-019 / T-021 / T-022 (list, step-up inbox, NL authoring) may be merged or still dirty — `git status` first

## Rules every session

- Branch `tNNN-fr…`. Conventional commit with the FR id. Never commit `.env`.
- Windows PowerShell: no `&&`. Use `; if ($LASTEXITCODE -eq 0) { … }`.
- A task is not done until `pnpm check` is green. Paste the output.
- Agent never gets a `pay` tool. No Razorpay keys or operator private key in `apps/web` or `apps/agent`.
- Do not start P2: **FR-06**, **FR-24**, **FR-75** (chain viewer fallback = `pnpm audit:verify` + screenshot).

---

## T-016 — FR-31 live test-mode settlement (P0 if still open)

```
Task T-016 — implement PRD FR-31 (one real test-mode settlement).

Read: PRD.md §6.4 FR-31, ARCHITECTURE.md §8, packages/rails/src/razorpay.ts,
packages/rails/src/razorpay.integration.test.ts.

Acceptance (from PRD): RazorpayTestRail against Day-0 primitive s2s_order.
One real test-mode settlement visible in Razorpay dashboard.

Constraints: rzp_test_ keys from local .env only. Never print secrets.
Skip (do not fail CI) if RAZORPAY_KEY_ID is missing. Do not touch packages/policy
or packages/audit. Do not start dashboard work.

Plan first (≤ 8 bullets, files to touch), wait for my OK, then test-first.
pnpm check green; paste output. End-of-task summary with FR-31.
```

---

## T-020 — FR-71 SSE decision stream

```
Task T-020 — implement PRD FR-71 (live decision stream).

Read: PRD.md §6.8 FR-71, §11.1 GET /events, apps/proxy/src/create-app.ts, apps/web/.

Acceptance (from PRD): Live decision stream (SSE) showing decision, reason code, checks.

Constraints: proxy owns SSE; dashboard only renders. No secrets in the browser.
Do not re-implement evaluate(). Do not touch packages/policy or packages/audit.
Do not start FR-72 in this chat.

Plan first (≤ 8 bullets, files to touch), wait for my OK, then test-first.
pnpm check green; paste output. End-of-task summary with FR-71.
```

---

## T-023 — FR-52 + FR-72 Explain

```
Task T-023 — implement PRD FR-52 and FR-72 (incident narrative).

Read: PRD.md §6.6 FR-52, §6.8 FR-72, §11.1 GET /exceptions and POST /exceptions/:id/explain,
apps/proxy, packages/audit.

Acceptance (from PRD): dashboard "Explain" on an exception → LLM produces a prose timeline
citing audit row seq numbers. Read-only view; rows remain source of truth.
Narrative references every row in the request's chain.

Constraints: no UPDATE/DELETE on AuditRow. Do not edit hash functions in packages/audit.
Do not start FR-75. Policy never reads free text (SEC-06 truncate 256).

Plan first, wait for my OK, test-first. pnpm check green; paste output.
End-of-task summary with FR-52 and FR-72.
```

---

## T-024 — FR-44 rationale visible

```
Task T-024 — implement PRD FR-44 (rationale visible).

Read: PRD.md §6.5 FR-44, SpendRequest.rationale, dashboard audit/decision views.

Acceptance (from PRD): rationale is captured on SpendRequest and shown in the audit row
(informational; never affects the decision).

Constraints: do not pass rationale into evaluate(). Do not touch packages/policy.
Plan first, wait for my OK. pnpm check green; paste output.
```

---

## T-025 — FR-82 red-team gate (verify, do not rewrite)

```
Task T-025 — verify PRD FR-82 for v0.4.0. Do not invent new RT ids.

Read: PRD.md §8 RT-01..RT-10, REDTEAM.md, package.json redteam script.

Acceptance (from PRD): pnpm redteam runs RT-01..RT-10 and writes REDTEAM.md with a
pass/fail table. Gate: all PASS. Commit REDTEAM.md (deliverable).

If a case fails, fix the smallest production path. Do not redefine the expected result.
Do not touch packages/policy or packages/audit without a TASKS.md line and a reason.

Run pnpm redteam and pnpm check. Paste both. Then stop so I can tag v0.4.0.
```

Human: `git tag -a v0.4.0 -m "dashboard P1 + redteam green"`

---

## T-026 — FR-83 README draft (you edit limitations)

```
Task T-026 — draft PRD FR-83 README only. I will rewrite the limitations section by hand.

Read: PRD.md §3 non-goals, §6.9 FR-83, §12, §14, ARCHITECTURE.md §8,
DEV-PROCESS.md §9–§10, current README.md.

Acceptance (from PRD): README has problem, what it is, 3-command quickstart, demo script,
metrics table, limitations. Update ARCHITECTURE.md only if a public contract changed.
Do not invent AP2/x402/UAP claims.

Constraints: test-mode only; no live money; no on-chain x402; logs tamper-evident not proof.
If MCP is not demoable, README uses the REST gate (PRD §14). Do not oversell.
Do not record a video. Do not tag v1.0.0.

Paste pnpm check. Stop.
```

---

## T-027 — video timing only

```
Task T-027 — do not write the pitch. Time PRD.md §12 at 150 wpm.

Return only: section name and word-count budget for
0:00–0:40, 0:40–1:20, 1:20–2:10, 2:10–2:50, 2:50–3:50, 3:50–5:00.
No script. No code.
```

You record. Agent does not narrate. Known-good run; commit transcript if useful (PRD §14).

---

## T-028 — fresh clone then v1.0.0

```
Task T-028 — FR-83 / NFR-02 / DEV-PROCESS §7 fresh-clone.

Acceptance: on a clean directory (or container), follow README only:
copy .env.example → .env, fill rzp_test_ keys, pnpm i && pnpm dev.
Time it. Must be < 5 minutes or you fix README (not the product).

Do not add features. Do not touch packages/policy or packages/audit.
When under 5 minutes, paste commands and elapsed time, then stop.
I will tag v1.0.0 and submit.
```

Human: `git tag -a v1.0.0 -m "submission"`

---

## Your job (not the agent's)

- Limitations paragraph in README
- Video voiceover (PRD §12)
- Track choice (Open vs Track 01) on the submission form + `ARCHITECTURE.md`
- Push tags when you want GitHub to match local
