# Security

Mandate is a **test-mode only** prototype for the Razorpay AI Buildathon 2026.

## Scope

- Live-mode Razorpay keys (`rzp_live_`) are out of scope and must not be present in the environment.
- Real money, real payouts, and production merchant data are out of scope.
- The repo must never contain API secrets, operator private keys, or webhook secrets.

## Key placement

| Secret | Who holds it | Who must never see it |
|---|---|---|
| Razorpay `KEY_ID` / `KEY_SECRET` | `apps/proxy` environment only | `apps/web`, `apps/agent`, any MCP client |
| Operator Ed25519 private key | Operator client (dashboard / local) | Proxy, agent, resource server |
| Operator public key | Proxy | — |
| Provider webhook HMAC secrets | Proxy + the issuing resource server | Agent, dashboard clients |
| Payment proofs | Bound to `invoice_id + resource + expires_at`, single-use | Replay is `409` |

## Reporting

This is a public student prototype. Do not file production vulnerability reports against it. If you find a way to reach `ALLOW` without every policy check passing, open a GitHub issue with a failing test, not an exploit write-up against Razorpay.

## Fail closed

Unknown upstream tools, unknown event types, and unknown reason codes deny. There is no bypass, dry-run, or skip-checks flag in the policy engine.
