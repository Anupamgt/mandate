"use client";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupeesFromPaise } from "@/lib/format";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://127.0.0.1:18787";

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

type PendingApproval = {
  spend_request_id: string;
  mandate_id: string;
  agent_id: string;
  tool: string;
  amount_paise: number;
  purpose: string;
  status: string;
  reason_code?: string;
  rationale?: string;
};

export default function ApprovalsPage() {
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`${PROXY}/spend/pending-approvals`);
    if (!res.ok) return;
    const json = (await res.json()) as { pending: PendingApproval[] };
    setPending(json.pending);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("mandate-operator");
    if (stored) setKeys(JSON.parse(stored) as { pub: string; priv: string });
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function signBody(body: unknown, priv: string) {
    const msg = utf8ToBytes(canonicalJson(body));
    return bytesToHex(await ed.signAsync(msg, hexToBytes(priv)));
  }

  async function approve(item: PendingApproval) {
    setError(null);
    setMessage(null);
    if (!keys) {
      setError(
        "Operator private key is not on this device. Issue a mandate from the console first so the key stays client-side.",
      );
      return;
    }
    setBusy(item.spend_request_id);
    try {
      const payload = {
        spend_request_id: item.spend_request_id,
        approved_at: new Date().toISOString(),
      };
      const signature = await signBody(payload, keys.priv);
      const res = await fetch(`${PROXY}/spend/${item.spend_request_id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, signature }),
      });
      const json = (await res.json()) as {
        decision?: string;
        reason_code?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.decision === "DENY") {
        setError(`Mandate no longer valid: ${json.reason_code}`);
      } else {
        setMessage(`Approved ${item.spend_request_id.slice(0, 8)}… · ${json.reason_code ?? "ALLOW"}`);
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm font-medium text-primary">Mandate</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Step-up inbox</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Approval is an operator-signed record over <code className="text-foreground">spend_request_id</code>. The
        private key stays in this browser. The LLM never signs. Payment still runs only inside the proxy after ALLOW.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/" className="text-primary hover:underline">
          Operator console
        </Link>
      </p>

      {error ? (
        <p className="mt-6 rounded-md border border-[#f07167]/40 bg-[#f07167]/10 px-3 py-2 text-sm text-[#f07167]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-6 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{message}</p>
      ) : null}

      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Pending STEP_UP</CardTitle>
              <CardDescription>From GET /spend/pending-approvals. Not a cookie or a boolean toggle.</CardDescription>
            </div>
            <Badge variant={pending.length > 0 ? "warn" : "ok"}>
              {pending.length === 0 ? "Clear" : `${pending.length} waiting`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending step-up spends.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((item) => (
                <li key={item.spend_request_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-mono text-sm font-medium">{item.reason_code ?? "STEP_UP_THRESHOLD"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRupeesFromPaise(item.amount_paise)} · {item.tool} · {item.purpose}
                    </p>
                    {item.rationale ? (
                      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        Rationale (informational): {item.rationale}
                      </p>
                    ) : null}
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{item.spend_request_id}</p>
                  </div>
                  <Button size="sm" onClick={() => void approve(item)} disabled={busy !== null}>
                    {busy === item.spend_request_id ? "Signing…" : "Approve"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
