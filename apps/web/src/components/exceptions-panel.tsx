"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  loadExceptions,
  requestExplain,
  type ExceptionRow,
  type ExplainResponse,
} from "@/lib/exceptions";

function exceptionVariant(eventType: string): "deny" | "warn" {
  return eventType === "EXCEPTION_UNRESOLVED" ? "warn" : "deny";
}

export function ExceptionsPanel({ proxy }: { proxy: string }) {
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explained, setExplained] = useState<ExplainResponse | null>(null);

  const refresh = useCallback(async () => {
    const rows = await loadExceptions(proxy);
    setExceptions(rows);
    setLoading(false);
  }, [proxy]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function explain(seq: number) {
    setError(null);
    setBusy(seq);
    try {
      const result = await requestExplain(proxy, seq);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setExplained(result);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-[#f07167]/40 bg-[#f07167]/10 px-3 py-2 text-sm text-[#f07167]">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Exceptions</CardTitle>
              <CardDescription>
                GET /exceptions. Explain is read-only prose citing audit seq. Rows stay the source of truth.
              </CardDescription>
            </div>
            <Badge variant={exceptions.length > 0 ? "deny" : "ok"}>
              {exceptions.length === 0 ? "Clear" : `${exceptions.length} open`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading exceptions…</p>
          ) : exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No EXCEPTION rows. Inject a provisioning failure (`fail_provision`) to raise one.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {exceptions.map((row) => (
                <li key={row.seq} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-mono text-sm font-medium">
                      seq {row.seq} · {row.eventType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.actor}
                      {row.reasonCode ? ` · ${row.reasonCode}` : ""} · {row.ts}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {row.spendRequestId ?? "no spend request"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={exceptionVariant(row.eventType)}>{row.eventType}</Badge>
                    <Button size="sm" onClick={() => void explain(row.seq)} disabled={busy !== null}>
                      {busy === row.seq ? "Explaining…" : "Explain"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {explained ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Narrative</CardTitle>
              <CardDescription>
                {explained.source === "llm" ? "LLM timeline" : "Deterministic fallback"} · exception seq{" "}
                {explained.exception_seq}. Not written to the audit chain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-foreground">{explained.narrative}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Audit rows</CardTitle>
              <CardDescription>
                Chain for spend request {explained.spend_request_id}. Hashes are shown; this view never updates them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {explained.rows.map((row) => (
                  <li key={row.seq} className="py-3">
                    <p className="font-mono text-sm font-medium">
                      seq {row.seq} · {row.eventType}
                      {row.decision ? ` · ${row.decision}` : ""}
                      {row.reasonCode ? ` · ${row.reasonCode}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.actor} · {row.ts}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{row.hash}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
