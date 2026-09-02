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
import { budgetPercent, formatRupeesFromPaise, parsePaiseInput } from "@/lib/format";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://127.0.0.1:18787";

const hashes = ed as unknown as { hashes?: { sha512?: typeof sha512 } };
if (hashes.hashes && !hashes.hashes.sha512) hashes.hashes.sha512 = sha512;

const TOOLS = [
  { id: "create_order", label: "Create order" },
  { id: "update_refund", label: "Update refund" },
  { id: "create_payout", label: "Create payout" },
] as const;

const AMOUNT_CHIPS = [
  { paise: 1000, hint: "₹10 · should allow" },
  { paise: 8001, hint: "Above step-up" },
  { paise: 20000, hint: "Over per-txn cap" },
] as const;

const NAV = [
  { id: "snapshot", label: "Snapshot" },
  { id: "mandate", label: "Mandate" },
  { id: "spend", label: "Spend" },
  { id: "activity", label: "Live activity" },
] as const;

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
  body: { max_total_paise: number; max_per_txn_paise: number; purpose: string; step_up_above_paise?: number };
};

type Decision = {
  spend_request_id?: string;
  decision?: string;
  reason_code?: string;
  checks?: string[];
  proof?: { invoice_id: string; mac: string; resource: string; expires_at: string };
  error?: string;
};

type LiveEvent = {
  id: string;
  ts: string;
  reason: string;
  decision: string;
  source: "local" | "stream";
};

function relativeTime(ts: number, now: number): string {
  const delta = Math.max(0, Math.floor((now - ts) / 1000));
  if (delta < 2) return "just now";
  if (delta < 60) return `${delta}s ago`;
  const mins = Math.floor(delta / 60);
  return `${mins}m ago`;
}

function statusVariant(code: string | undefined): "ok" | "deny" | "warn" | "default" {
  if (code === "ALLOW") return "ok";
  if (code === "STEP_UP_THRESHOLD") return "warn";
  if (!code) return "default";
  return "deny";
}

export default function Page() {
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("1000");
  const [tool, setTool] = useState("create_order");
  const [proxyUp, setProxyUp] = useState<boolean | null>(null);
  const [sseOn, setSseOn] = useState(false);
  const [auditOk, setAuditOk] = useState<boolean | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("snapshot");

  const selected = mandates[0];
  const remainingPct = useMemo(() => {
    if (!selected) return 0;
    return budgetPercent(selected.remaining_paise, selected.body.max_total_paise);
  }, [selected]);
  const spentPct = 100 - remainingPct;
  const parsedAmount = parsePaiseInput(amount);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${PROXY}/mandates`);
      if (!res.ok) return;
      const json = (await res.json()) as { mandates: Mandate[] };
      setMandates(json.mandates);
      setRefreshedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("mandate-operator");
    if (stored) setKeys(JSON.parse(stored) as { pub: string; priv: string });
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let stopped = false;
    async function ping() {
      try {
        const res = await fetch(`${PROXY}/health`);
        if (stopped) return;
        setProxyUp(res.ok);
      } catch {
        if (!stopped) setProxyUp(false);
      }
    }
    void ping();
    const t = setInterval(() => void ping(), 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function verify() {
      try {
        const res = await fetch(`${PROXY}/audit/verify`);
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { ok?: boolean };
        setAuditOk(json.ok === true);
      } catch {
        if (!stopped) setAuditOk(null);
      }
    }
    void verify();
    const t = setInterval(() => void verify(), 8000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      es = new EventSource(`${PROXY}/events`);
      es.addEventListener("open", () => setSseOn(true));
      es.addEventListener("decision", (ev) => {
        const row = JSON.parse((ev as MessageEvent).data) as {
          seq?: number;
          reasonCode?: string;
          decision?: string;
          ts?: string;
          spendRequestId?: string;
        };
        const id = row.spendRequestId ?? String(row.seq ?? Date.now());
        setEvents((prev) => {
          if (prev.some((p) => p.id === id)) return prev;
          return [
            {
              id,
              ts: row.ts ?? new Date().toISOString(),
              reason: row.reasonCode ?? "DECISION",
              decision: row.decision ?? "DENY",
              source: "stream",
            },
            ...prev,
          ].slice(0, 16);
        });
      });
      es.onerror = () => {
        setSseOn(false);
        es?.close();
        if (!stopped) retry = setTimeout(connect, 1600);
      };
    }

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

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
    const paise = parsePaiseInput(amount);
    if (paise === null) {
      setError("Amount must be integer paise.");
      return;
    }
    setBusy("propose");
    try {
      const res = await fetch(`${PROXY}/spend/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "agent_demo",
          tool,
          counterparty_id: "prov_compute_a",
          amount_paise: paise,
          purpose: "dashboard propose",
          rationale: "operator-triggered demo spend",
        }),
      });
      const json = (await res.json()) as Decision;
      const id = json.spend_request_id ?? `local-${Date.now()}`;
      setEvents((prev) => {
        if (prev.some((p) => p.id === id)) return prev;
        return [
          {
            id,
            ts: new Date().toISOString(),
            reason: json.reason_code ?? json.error ?? "ERROR",
            decision: json.decision ?? "ERR",
            source: "local",
          },
          ...prev,
        ].slice(0, 16);
      });
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

  function scrollTo(id: string) {
    setSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-secondary text-secondary-foreground">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-extrabold">
            M
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Mandate</p>
            <p className="text-[11px] text-white/60">Razorpay test mode</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollTo(item.id)}
              className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                section === item.id ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 text-xs text-white/55 md:block">
          Agent never gets a pay tool. Policy is evaluate() on the proxy.
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-3 backdrop-blur md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Payments · Agents</p>
            <h1 className="text-lg font-bold tracking-tight">Operator console</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={proxyUp ? "ok" : proxyUp === false ? "deny" : "warn"}>
              {proxyUp ? "Proxy live" : proxyUp === false ? "Proxy down" : "Checking proxy"}
            </Badge>
            <Badge variant={sseOn ? "ok" : "warn"}>{sseOn ? "Live stream" : "Reconnecting"}</Badge>
            <Badge variant={keys ? "ok" : "warn"}>{keys ? "Key on this device" : "No operator key"}</Badge>
          </div>
        </header>

        <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
          {error ? (
            <p className="rounded-md border border-[#f5c2c0] bg-[#fdecec] px-3 py-2 text-sm text-[#b42318]">{error}</p>
          ) : null}

          <section id="snapshot" className="scroll-mt-24">
            <SectionLabel n="01" title="Snapshot" hint={refreshedAt ? `Updated ${relativeTime(refreshedAt, nowTick)}` : "Waiting for proxy"} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Remaining"
                value={selected ? formatRupeesFromPaise(selected.remaining_paise) : "—"}
                sub={selected ? `of ${formatRupeesFromPaise(selected.body.max_total_paise)}` : "Issue a mandate"}
              />
              <Stat
                label="Per-txn cap"
                value={selected ? formatRupeesFromPaise(selected.body.max_per_txn_paise) : "—"}
                sub="Hard deny above this"
              />
              <Stat
                label="Mandate"
                value={selected?.status ?? "NONE"}
                sub={selected ? selected.agent_id : "No agent bound"}
              />
              <Stat
                label="Audit chain"
                value={auditOk === true ? "Intact" : auditOk === false ? "Broken" : "—"}
                sub={sseOn ? "Streaming decisions" : "Stream idle"}
              />
            </div>
          </section>

          <section id="mandate" className="scroll-mt-24">
            <SectionLabel n="02" title="Mandate" hint="Signed on this device. Proxy holds only the public key." />
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Active authority</CardTitle>
                    <CardDescription>
                      Remaining budget is settled plus live reservations against the cumulative cap.
                    </CardDescription>
                  </div>
                  {selected ? (
                    <Badge variant={selected.status === "ACTIVE" ? "ok" : "deny"}>{selected.status}</Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading mandates…</p>
                ) : selected ? (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
                      <p className="font-mono text-xs text-muted-foreground">
                        {selected.id.slice(0, 8)}… · {selected.agent_id} · {selected.body.purpose}
                      </p>
                      <p className="font-mono text-sm font-semibold">
                        {formatRupeesFromPaise(selected.remaining_paise)} left
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Spent {spentPct}%</span>
                        <span>Available {remainingPct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="budget-fill h-full rounded-full bg-primary"
                          style={{ width: `${remainingPct}%` }}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No mandate yet. Issue a demo cap of ₹500 total / ₹100 per txn to start.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void issueDemo()} disabled={busy !== null}>
                    {busy === "issue" ? "Signing…" : "Issue demo mandate"}
                  </Button>
                  <Button variant="destructive" onClick={() => void revoke()} disabled={!selected || !keys || busy !== null}>
                    {busy === "revoke" ? "Revoking…" : "Revoke"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="spend" className="scroll-mt-24">
            <SectionLabel n="03" title="Propose spend" hint="Goes through evaluate(). There is no pay tool on the agent." />
            <Card>
              <CardHeader>
                <CardTitle>New proposal</CardTitle>
                <CardDescription>
                  Amount is integer paise. Shown live as rupees. Unknown tools fail closed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>MCP tool</Label>
                  <div className="flex flex-wrap gap-2">
                    {TOOLS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTool(t.id)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          tool === t.id
                            ? "border-primary bg-[#e8f4ff] text-secondary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {tool === "create_payout" ? (
                    <p className="text-xs text-[#9a6700]">create_payout is unclassified on this test account → TOOL_UNCLASSIFIED.</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="amt">Amount (paise)</Label>
                    <span className="font-mono text-sm font-semibold text-secondary">
                      {parsedAmount === null ? "—" : formatRupeesFromPaise(parsedAmount)}
                    </span>
                  </div>
                  <Input
                    id="amt"
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-describedby="amt-help"
                  />
                  <div className="flex flex-wrap gap-2">
                    {AMOUNT_CHIPS.map((chip) => (
                      <button
                        key={chip.paise}
                        type="button"
                        onClick={() => setAmount(String(chip.paise))}
                        className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-secondary"
                      >
                        {chip.hint}
                      </button>
                    ))}
                  </div>
                  <p id="amt-help" className="text-xs text-muted-foreground">
                    100 paise = ₹1. Try ₹200 to trip the per-txn cap.
                  </p>
                </div>
                <Button className="w-full sm:w-auto" onClick={() => void propose()} disabled={busy !== null}>
                  {busy === "propose" ? "Evaluating…" : "Propose spend"}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section id="activity" className="scroll-mt-24">
            <SectionLabel n="04" title="Live activity" hint="SSE from the proxy, plus decisions from this browser." />
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>Decisions</CardTitle>
                    <CardDescription>Newest first. Each row is one evaluate() result.</CardDescription>
                  </div>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${sseOn ? "live-dot bg-success" : "bg-[#c17b00]"}`} />
                    {sseOn ? "Receiving" : "Idle"}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No proposals yet. Spend above to see a structured decision.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {events.map((ev) => (
                      <li key={ev.id} className="row-enter flex items-start justify-between gap-3 py-3">
                        <div>
                          <p className="font-mono text-sm font-medium">{ev.reason}</p>
                          <p className="text-xs text-muted-foreground">
                            {relativeTime(Date.parse(ev.ts) || nowTick, nowTick)} · {ev.source === "stream" ? "stream" : "this session"}
                          </p>
                        </div>
                        <Badge variant={statusVariant(ev.reason)}>{ev.decision}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}

function SectionLabel({ n, title, hint }: { n: string; title: string; hint: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-sm font-bold tracking-tight text-secondary">
        <span className="mr-2 font-mono text-xs font-medium text-primary">{n}</span>
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-xl font-semibold tracking-tight text-secondary">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
