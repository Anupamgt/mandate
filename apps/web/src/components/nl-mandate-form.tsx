"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canSignNlDraft,
  englishReadback,
  formToMandateBody,
  liveDraftWarnings,
  toDraftForm,
  warningCopy,
  type DraftBody,
  type DraftForm,
  type DraftWarning,
} from "@/nl-draft";

type Keys = { pub: string; priv: string };

export function NlMandateForm({
  proxy,
  busy,
  onBusy,
  onError,
  ensureKeys,
  signBody,
  onIssued,
}: {
  proxy: string;
  busy: string | null;
  onBusy: (value: string | null) => void;
  onError: (value: string | null) => void;
  ensureKeys: () => Promise<Keys>;
  signBody: (body: unknown, priv: string) => Promise<string>;
  onIssued: () => Promise<void>;
}) {
  const [intent, setIntent] = useState("");
  const [form, setForm] = useState<DraftForm | null>(null);
  const [original, setOriginal] = useState<DraftForm | null>(null);
  const [seed, setSeed] = useState<DraftWarning[]>([]);
  const [capsTouched, setCapsTouched] = useState(false);

  const warnings = useMemo(() => {
    if (!form || !original) return seed;
    return liveDraftWarnings(form, seed, original, capsTouched);
  }, [form, original, seed, capsTouched]);
  const canSign = canSignNlDraft(warnings);
  const readback = form ? englishReadback(form) : "";

  function patch(update: Partial<DraftForm>, touchCaps = false) {
    setForm((prev) => (prev ? { ...prev, ...update } : prev));
    if (touchCaps) setCapsTouched(true);
  }

  async function draft() {
    onError(null);
    onBusy("draft");
    try {
      const res = await fetch(`${proxy}/mandates/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { body: DraftBody; warnings: DraftWarning[] };
      const next = toDraftForm(json.body);
      setForm(next);
      setOriginal(next);
      setSeed(json.warnings);
      setCapsTouched(false);
    } catch (e) {
      onError(String(e));
    } finally {
      onBusy(null);
    }
  }

  async function issue() {
    if (!form) return;
    const body = formToMandateBody(form);
    if (typeof body === "string") {
      onError(body);
      return;
    }
    if (!canSign) {
      onError("Fill the allowlist and caps before signing. The draft never signs.");
      return;
    }
    onError(null);
    onBusy("nl-issue");
    try {
      const k = await ensureKeys();
      const signature = await signBody(body, k.priv);
      const res = await fetch(`${proxy}/mandates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, signature }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onIssued();
    } catch (e) {
      onError(String(e));
    } finally {
      onBusy(null);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Natural-language draft</CardTitle>
        <CardDescription>
          Describe the authority in plain English. The proxy returns a schema-constrained JSON draft. You edit and
          sign on this device — the model never signs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="nl-intent">Intent</Label>
          <textarea
            id="nl-intent"
            maxLength={256}
            rows={3}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. no limit, pay anyone"
            className="flex min-h-[84px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{intent.length}/256 · truncated server-side (SEC-06)</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void draft()} disabled={busy !== null}>
          {busy === "draft" ? "Drafting…" : "Draft mandate"}
        </Button>

        {form ? (
          <>
            {warnings.length > 0 ? (
              <ul className="space-y-1 rounded-md border border-[#e6b84f]/40 bg-[#e6b84f]/10 px-3 py-2 text-sm text-[#e6b84f]">
                {warnings.map((code) => (
                  <li key={code}>{warningCopy(code)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Warnings cleared. You can sign this draft.</p>
            )}

            <div className="rounded-md border border-border bg-muted/40 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Readback</p>
              <p className="mt-2 text-sm leading-6 text-foreground">{readback}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Agent id" value={form.agent_id} onChange={(v) => patch({ agent_id: v })} />
              <Field label="Principal id" value={form.principal_id} onChange={(v) => patch({ principal_id: v })} />
              <Field
                label="Max per txn (paise)"
                value={form.max_per_txn_paise}
                onChange={(v) => patch({ max_per_txn_paise: v }, true)}
              />
              <Field
                label="Max total (paise)"
                value={form.max_total_paise}
                onChange={(v) => patch({ max_total_paise: v }, true)}
              />
              <Field label="Valid from" value={form.valid_from} onChange={(v) => patch({ valid_from: v })} />
              <Field label="Valid until" value={form.valid_until} onChange={(v) => patch({ valid_until: v })} />
              <Field
                label="Allowed counterparties"
                value={form.allowed_counterparties}
                onChange={(v) => patch({ allowed_counterparties: v })}
                hint="Comma-separated. Required before signing."
              />
              <Field
                label="Allowed tools"
                value={form.allowed_tools}
                onChange={(v) => patch({ allowed_tools: v })}
              />
              <Field label="Purpose" value={form.purpose} onChange={(v) => patch({ purpose: v })} />
              <Field
                label="Step-up above (paise)"
                value={form.step_up_above_paise}
                onChange={(v) => patch({ step_up_above_paise: v })}
              />
            </div>

            <Button type="button" onClick={() => void issue()} disabled={busy !== null || !canSign}>
              {busy === "nl-issue" ? "Signing…" : "Sign and issue"}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
