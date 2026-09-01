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

Commands: `pnpm dev` · `pnpm test` · `pnpm batch` · `pnpm redteam` · `pnpm lint`

**When in doubt, PRD.md wins over any code comment.** DEV-PROCESS.md is the build protocol. Do not edit those two files. ARCHITECTURE.md is the public contract; if it disagrees with PRD.md, change the code and ARCHITECTURE, not the PRD. If PRD.md is not in the tree, ARCHITECTURE.md is the stand-in until the original is added.
