# Mandate — agent orientation

Governance proxy between any MCP client and Razorpay's MCP server. Signed mandates, deterministic `evaluate()`, hash-chained audit, one injected failure reversed.

```
MCP client / showcase agent
        │
        ▼
   apps/proxy  ──policy──► packages/policy (pure)
        │                  packages/mandate, audit, rails, shared
        ├── MONEY_*  → evaluate → reserve → rail.pay → reconcile
        └── READ     → forward + audit row
        │
        ▼
 mcp.razorpay.com  (keys live only here)
```

Commands (after T-001): `pnpm dev` · `pnpm test` · `pnpm batch`

Internal acceptance list is the off-repo PRD (attach it). Public contract is `ARCHITECTURE.md`. **When in doubt, the attached PRD wins over any code comment; if no PRD is attached, ARCHITECTURE.md wins.**
