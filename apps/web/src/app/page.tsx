"use client";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://127.0.0.1:18787";

/** FR-14: format paise as rupees with integer arithmetic only (no toFixed/parseFloat). */
function formatRupeesFromPaise(paise: number): string {
  const negative = paise < 0;
  const abs = negative ? -paise : paise;
  const rupees = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${negative ? "-" : ""}₹${rupees}.${String(remainder).padStart(2, "0")}`;
}

const hashes = ed as unknown as { hashes?: { sha512?: typeof sha512 } };
if (hashes.hashes && !hashes.hashes.sha512) hashes.hashes.sha512 = sha512;

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rec).sort()) {
    const v = rec[key];
    if (v !== undefined) out[key] = sortValue(v);
  }
  return out;
}

type Mandate = {
  id: string;
  status: string;
  agent_id: string;
  remaining_paise: number;
  body: { max_total_paise: number; max_per_txn_paise: number; purpose: string };
};

type Decision = {
  spend_request_id?: string;
  decision?: string;
  reason_code?: string;
  checks?: string[];
  proof?: { invoice_id: string; mac: string; resource: string; expires_at: string };
  error?: string;
};

export default function Page() {
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("1000");
  const [tool, setTool] = useState("create_order");

  const selected = mandates[0];
  const remainingPct = useMemo(() => {
    if (!selected) return 0;
    const max = selected.body.max_total_paise || 1;
    return Math.max(0, Math.min(100, Math.floor((selected.remaining_paise * 100) / max)));
  }, [selected]);

  const refresh = useCallback(async () => {
    const res = await fetch(`${PROXY}/mandates`);
    if (!res.ok) return;
    const json = (await res.json()) as { mandates: Mandate[] };
    setMandates(json.mandates);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("mandate-operator");
    if (stored) setKeys(JSON.parse(stored) as { pub: string; priv: string });
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function ensureKeys() {
    if (keys) return keys;
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const next = { priv: bytesToHex(priv), pub: bytesToHex(pub) };
    localStorage.setItem("mandate-operator", JSON.stringify(next));
    setKeys(next);
    await fetch(`${PROXY}/operator/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ public_key: next.pub }),
    });
    return next;
  }

  async function signBody(body: unknown, priv: string) {
    const msg = utf8ToBytes(canonicalJson(body));
    return bytesToHex(await ed.signAsync(msg, hexToBytes(priv)));
  }

  async function issueDemo() {
    setError(null);
    setBusy("issue");
    try {
      const k = await ensureKeys();
      const body = {
        agent_id: "agent_demo",
        principal_id: "operator",
        max_per_txn_paise: 10_000,
        max_total_paise: 50_000,
        valid_from: new Date(Date.now() - 60_000).toISOString(),
        valid_until: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
        allowed_counterparties: ["prov_compute_a", "razorpay"],
        allowed_tools: ["create_order", "update_refund"],
        purpose: "showcase compute",
        step_up_above_paise: 8_000,
      };
      const signature = await signBody(body, k.priv);
      const res = await fetch(`${PROXY}/mandates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, signature }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function propose() {
    setError(null);
    setBusy("propose");
    try {
      const res = await fetch(`${PROXY}/spend/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "agent_demo",
          tool,
          counterparty_id: "prov_compute_a",
          amount_paise: Number(amount),
          purpose: "dashboard propose",
          rationale: "operator-triggered demo spend",
        }),
      });
      const json = (await res.json()) as Decision;
      setDecisions((d) => [json, ...d].slice(0, 12));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!selected || !keys) return;
    setBusy("revoke");
    try {
      const payload = {
        mandate_id: selected.id,
        reason: "operator stop",
        revoked_at: new Date().toISOString(),
      };
      const signature = await signBody(payload, keys.priv);
      const res = await fetch(`${PROXY}/mandates/${selected.id}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, signature }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Razorpay AI Buildathon 2026</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Mandate</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Bounded, revocable authority between any MCP agent and Razorpay money tools. The agent never gets a pay
            button. Policy is deterministic. Every attempt is hash-chained.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={keys ? "ok" : "warn"}>{keys ? "operator key on this device" : "no operator key yet"}</Badge>
          <Badge>MCP POST {PROXY}/mcp</Badge>
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Active mandate</CardTitle>
            <CardDescription>Remaining budget is settled + live reservations against the cumulative cap.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{selected.id.slice(0, 8)}… · {selected.agent_id}</span>
                  <Badge variant={selected.status === "ACTIVE" ? "ok" : "deny"}>{selected.status}</Badge>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${remainingPct}%` }} />
                </div>
                <p className="text-sm">
                  {formatRupeesFromPaise(selected.remaining_paise)} remaining of{" "}
                  {formatRupeesFromPaise(selected.body.max_total_paise)} ·{" "}
                  {formatRupeesFromPaise(selected.body.max_per_txn_paise)} per txn · {selected.body.purpose}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No mandate yet. Issue one to start the demo.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void issueDemo()} disabled={busy !== null}>
                {busy === "issue" ? "Signing…" : "Issue demo mandate"}
              </Button>
              <Button variant="destructive" onClick={() => void revoke()} disabled={!selected || busy !== null}>
                Revoke
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Propose spend</CardTitle>
            <CardDescription>Goes through evaluate() on the proxy. No pay tool on the agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tool">MCP tool</Label>
              <Input id="tool" value={tool} onChange={(e) => setTool(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="amt">Amount (paise)</Label>
              <Input id="amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button className="w-full" onClick={() => void propose()} disabled={busy !== null}>
              {busy === "propose" ? "Evaluating…" : "POST /spend/propose"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Try 20000 paise to trip PER_TXN_CAP_EXCEEDED, or tool create_payout for TOOL_UNCLASSIFIED.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Decisions</CardTitle>
            <CardDescription>Latest evaluate() results from this browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals yet.</p>
            ) : (
              decisions.map((d, i) => (
                <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="font-mono text-sm">{d.reason_code ?? d.error ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{d.checks?.slice(-3).join(" · ")}</p>
                  </div>
                  <Badge variant={d.reason_code === "ALLOW" ? "ok" : d.reason_code === "STEP_UP_THRESHOLD" ? "warn" : "deny"}>
                    {d.decision ?? "ERR"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>MCP proxy</CardTitle>
            <CardDescription>stdio + streamable HTTP. Session needs X-Mandate-Agent-Id.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Cursor / Claude Desktop: run <code className="text-foreground">pnpm dev:mcp</code> with{" "}
              <code className="text-foreground">MANDATE_AGENT_ID=agent_demo</code>. Money tools call evaluate(); missing
              agent id is NO_MANDATE; unknown names are TOOL_UNCLASSIFIED.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs text-foreground">{`{
  "mcpServers": {
    "mandate": {
      "command": "pnpm",
      "args": ["--filter", "@mandate/proxy", "mcp"],
      "env": { "MANDATE_AGENT_ID": "agent_demo" }
    }
  }
}`}</pre>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
