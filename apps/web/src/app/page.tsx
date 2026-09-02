"use client";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

const PAGES = [
  { id: "snapshot", label: "Snapshot" },
  { id: "mandate", label: "Issue a mandate" },
  { id: "spend", label: "Propose spend" },
  { id: "approvals", label: "Approvals inbox" },
  { id: "activity", label: "Live activity" },
  { id: "how-it-works", label: "How evaluate() works" },
] as const;

const TOC = [
  { id: "snapshot", label: "Snapshot" },
  { id: "mandate", label: "Issue a mandate" },
  { id: "spend", label: "Propose spend" },
  { id: "approvals", label: "Approvals inbox" },
  { id: "activity", label: "Live activity" },
  { id: "how-it-works", label: "How evaluate() works" },
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

type PendingApproval = {
  spend_request_id: string;
  mandate_id: string;
  agent_id: string;
  tool: string;
  amount_paise: number;
  purpose: string;
  status: string;
  reason_code?: string;
  decided_at?: string | null;
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path fill="currentColor" d="M6 3.2 11.2 8 6 12.8 5.2 12 9.4 8 5.2 4z" />
    </svg>
  );
}

export default function Page() {
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
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
  const [treeOpen, setTreeOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState("");
  const [benefitsOpen, setBenefitsOpen] = useState(true);
  const [mcpOpen, setMcpOpen] = useState(false);

  const selected = mandates[0];
  const remainingPct = useMemo(() => {
    if (!selected) return 0;
    return budgetPercent(selected.remaining_paise, selected.body.max_total_paise);
  }, [selected]);
  const spentPct = 100 - remainingPct;
  const parsedAmount = parsePaiseInput(amount);
  const pageIndex = PAGES.findIndex((p) => p.id === section);
  const prevPage = pageIndex > 0 ? PAGES[pageIndex - 1] : undefined;
  const nextPage = pageIndex >= 0 && pageIndex < PAGES.length - 1 ? PAGES[pageIndex + 1] : undefined;
  const filteredToc = TOC.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));

  const refresh = useCallback(async () => {
    try {
      const [mandateRes, pendingRes] = await Promise.all([
        fetch(`${PROXY}/mandates`),
        fetch(`${PROXY}/spend/pending-approvals`),
      ]);
      if (mandateRes.ok) {
        const json = (await mandateRes.json()) as { mandates: Mandate[] };
        setMandates(json.mandates);
      }
      if (pendingRes.ok) {
        const json = (await pendingRes.json()) as { pending: PendingApproval[] };
        setPending(json.pending);
      }
      if (mandateRes.ok || pendingRes.ok) setRefreshedAt(Date.now());
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

  useEffect(() => {
    const ids = TOC.map((item) => item.id);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const id = visible[0]?.target.id;
        if (id) setSection(id);
      },
      { rootMargin: "-18% 0px -64% 0px", threshold: [0, 0.2, 0.45, 0.7] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
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

  async function approvePending(item: PendingApproval) {
    setError(null);
    setBusy(`approve:${item.spend_request_id}`);
    try {
      const k = await ensureKeys();
      const payload = {
        spend_request_id: item.spend_request_id,
        approved_at: new Date().toISOString(),
      };
      const signature = await signBody(payload, k.priv);
      const res = await fetch(`${PROXY}/spend/${item.spend_request_id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, signature }),
      });
      const json = (await res.json()) as { decision?: string; reason_code?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "approval failed");
      if (json.decision === "DENY") {
        throw new Error(json.reason_code ?? "DENY");
      }
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

  function goTo(id: string) {
    setSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function jumpFromQuery(q: string) {
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const hit = TOC.find((item) => item.label.toLowerCase().includes(needle) || item.id.includes(needle));
    if (hit) {
      goTo(hit.id);
      setAsk("");
      setSearch("");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-extrabold">M</span>
            <p className="text-sm font-semibold">Mandate Docs</p>
          </div>
          <label className="relative hidden min-w-0 flex-1 md:block">
            <span className="sr-only">Search this page</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpFromQuery(search);
              }}
              placeholder="Search…"
              className="h-9 w-full max-w-md rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <kbd className="pointer-events-none absolute right-2 top-1.5 hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground lg:inline">
              Enter
            </kbd>
          </label>
          <nav className="ml-auto hidden items-center gap-5 text-sm text-muted-foreground lg:flex">
            <span>Payments</span>
            <span>Banking Plus</span>
            <span className="border-b-2 border-primary pb-0.5 font-medium text-foreground">Developer Tools</span>
          </nav>
          <Badge variant={proxyUp ? "ok" : proxyUp === false ? "deny" : "warn"}>
            {proxyUp ? "Proxy live" : proxyUp === false ? "Proxy down" : "Checking"}
          </Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        <aside className="border-b border-border px-3 py-4 lg:sticky lg:top-14 lg:h-[calc(100vh-56px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Developer Tools
          </p>
          <button
            type="button"
            onClick={() => setTreeOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            <Chevron open={treeOpen} />
            Mandate
          </button>
          {treeOpen ? (
            <div className="ml-3 mt-1 space-y-0.5 border-l border-border pl-2">
              {PAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(item.id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    section === item.id ? "bg-[#152033] text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <main className="relative min-w-0 px-4 py-8 sm:px-8 lg:px-12">
          <p className="text-sm font-medium text-primary">Mandate</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">Operator console</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Bounded, revocable authority between any MCP agent and Razorpay money tools. The agent never gets a pay
            button. Policy is deterministic. Every attempt is hash-chained.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">Available in IN India</span>
            <Badge variant={sseOn ? "ok" : "warn"}>{sseOn ? "Live stream" : "Reconnecting"}</Badge>
            <Badge variant={keys ? "ok" : "warn"}>{keys ? "Key on this device" : "No operator key"}</Badge>
          </div>

          {error ? (
            <p className="mt-6 rounded-md border border-[#f07167]/40 bg-[#f07167]/10 px-3 py-2 text-sm text-[#f07167]">{error}</p>
          ) : null}

          <section id="snapshot" className="scroll-mt-24 mt-14">
            <h2 className="text-2xl font-semibold tracking-tight">Snapshot</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {refreshedAt ? `Updated ${relativeTime(refreshedAt, nowTick)}` : "Waiting for proxy"}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
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

          <section id="mandate" className="scroll-mt-24 mt-16">
            <h2 className="text-2xl font-semibold tracking-tight">Issue a mandate</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Signed on this device. The proxy holds only the public key. Remaining budget is settled plus live
              reservations against the cumulative cap.
            </p>
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Active authority</CardTitle>
                    <CardDescription>Demo cap is ₹500 total / ₹100 per txn.</CardDescription>
                  </div>
                  {selected ? <Badge variant={selected.status === "ACTIVE" ? "ok" : "deny"}>{selected.status}</Badge> : null}
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
                        <div className="budget-fill h-full rounded-full bg-primary" style={{ width: `${remainingPct}%` }} />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No mandate yet. Issue one to start the demo.</p>
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

          <section id="spend" className="scroll-mt-24 mt-16">
            <h2 className="text-2xl font-semibold tracking-tight">Propose spend</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Goes through evaluate(). Amount is integer paise, shown live as rupees. Unknown tools fail closed.
            </p>
            <Card className="mt-6">
              <CardContent className="space-y-4 pt-5">
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
                            ? "border-primary bg-[#0d94fb]/15 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {tool === "create_payout" ? (
                    <p className="text-xs text-notice">create_payout is unclassified on this test account → TOOL_UNCLASSIFIED.</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="amt">Amount (paise)</Label>
                    <span className="font-mono text-sm font-semibold">
                      {parsedAmount === null ? "—" : formatRupeesFromPaise(parsedAmount)}
                    </span>
                  </div>
                  <Input id="amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {AMOUNT_CHIPS.map((chip) => (
                      <button
                        key={chip.paise}
                        type="button"
                        onClick={() => setAmount(String(chip.paise))}
                        className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                      >
                        {chip.hint}
                      </button>
                    ))}
                  </div>
                </div>
                <Button onClick={() => void propose()} disabled={busy !== null}>
                  {busy === "propose" ? "Evaluating…" : "Propose spend"}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section id="approvals" className="scroll-mt-24 mt-16">
            <h2 className="text-2xl font-semibold tracking-tight">Approvals inbox</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              STEP_UP spends wait here. Approve signs <code className="text-foreground">spend_request_id</code> and{" "}
              <code className="text-foreground">approved_at</code> on this device. The proxy verifies before proceeding.
            </p>
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>Pending step-up</CardTitle>
                    <CardDescription>Operator-signed records only. The LLM never signs.</CardDescription>
                  </div>
                  <Badge variant={pending.length > 0 ? "warn" : "ok"}>
                    {pending.length === 0 ? "Clear" : `${pending.length} waiting`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No STEP_UP requests. Propose above the step-up threshold to queue one.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {pending.map((item) => (
                      <li key={item.spend_request_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div>
                          <p className="font-mono text-sm font-medium">{item.reason_code ?? "STEP_UP_THRESHOLD"}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatRupeesFromPaise(item.amount_paise)} · {item.tool} · {item.purpose}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {item.spend_request_id.slice(0, 8)}…
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => void approvePending(item)}
                          disabled={busy !== null}
                        >
                          {busy === `approve:${item.spend_request_id}` ? "Signing…" : "Approve"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          <section id="activity" className="scroll-mt-24 mt-16">
            <h2 className="text-2xl font-semibold tracking-tight">Live activity</h2>
            <p className="mt-2 text-sm text-muted-foreground">SSE from the proxy, plus decisions from this browser.</p>
            <Card className="mt-6">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Decisions</CardTitle>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${sseOn ? "live-dot bg-success" : "bg-notice"}`} />
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

          <section id="how-it-works" className="scroll-mt-24 mt-16 space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">How evaluate() works</h2>
            <AccordionRow title="Benefits" open={benefitsOpen} onToggle={() => setBenefitsOpen((v) => !v)}>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                <li>Fail closed on unknown tools, events, and reason codes.</li>
                <li>Ed25519 signature verified on every decision. No cached validity.</li>
                <li>Reserve-then-settle so parallel spends cannot blow the cumulative cap.</li>
              </ul>
            </AccordionRow>
            <AccordionRow title="MCP session" open={mcpOpen} onToggle={() => setMcpOpen((v) => !v)}>
              <p className="text-sm leading-6 text-muted-foreground">
                Cursor / Claude Desktop: run <code className="text-foreground">pnpm dev:mcp</code> with{" "}
                <code className="text-foreground">MANDATE_AGENT_ID=agent_demo</code>. Missing agent id is NO_MANDATE.
              </p>
            </AccordionRow>
          </section>

          <nav className="mt-16 flex items-stretch justify-between gap-4 border-t border-border pt-8" aria-label="Section pagination">
            {prevPage ? (
              <button
                type="button"
                onClick={() => goTo(prevPage.id)}
                className="min-w-0 flex-1 rounded-xl border border-border px-4 py-4 text-left hover:border-primary/60"
              >
                <p className="text-xs text-muted-foreground">Previous</p>
                <p className="mt-1 truncate font-medium">{prevPage.label}</p>
              </button>
            ) : (
              <span className="flex-1" />
            )}
            {nextPage ? (
              <button
                type="button"
                onClick={() => goTo(nextPage.id)}
                className="min-w-0 flex-1 rounded-xl border border-border px-4 py-4 text-right hover:border-primary/60"
              >
                <p className="text-xs text-muted-foreground">Next</p>
                <p className="mt-1 truncate font-medium">{nextPage.label}</p>
              </button>
            ) : null}
          </nav>

          <form
            className="sticky bottom-4 mt-10 flex items-center gap-2 rounded-full border border-border bg-card/90 p-1.5 shadow-lg shadow-black/40 backdrop-blur"
            onSubmit={(e) => {
              e.preventDefault();
              jumpFromQuery(ask);
            }}
          >
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Ask a question…"
              className="h-10 flex-1 bg-transparent px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-label="Go to matching section"
            >
              ↑
            </button>
          </form>
        </main>

        <aside className="hidden xl:block xl:sticky xl:top-14 xl:h-[calc(100vh-56px)] xl:overflow-y-auto xl:border-l xl:border-border xl:px-5 xl:py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
          <nav className="mt-3 space-y-1">
            {(search ? filteredToc : TOC).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(item.id)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  section === item.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
            {search && filteredToc.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No matching headings.</p>
            ) : null}
          </nav>
        </aside>
      </div>
    </div>
  );
}

function AccordionRow({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Chevron open={open} />
        <span className="text-sm font-medium">{title}</span>
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
