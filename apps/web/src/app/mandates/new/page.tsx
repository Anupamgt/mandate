"use client";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { useCallback, useEffect, useState } from "react";
import { NlMandateForm } from "@/components/nl-mandate-form";

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

type Keys = { pub: string; priv: string };

export default function NewMandatePage() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("mandate-operator");
    if (stored) setKeys(JSON.parse(stored) as Keys);
  }, []);

  const ensureKeys = useCallback(async () => {
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
  }, [keys]);

  const signBody = useCallback(async (body: unknown, priv: string) => {
    const msg = utf8ToBytes(canonicalJson(body));
    return bytesToHex(await ed.signAsync(msg, hexToBytes(priv)));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-muted-foreground">
        <a href="/" className="underline">
          Mandates
        </a>
        {" · "}
        Author mandate
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Author a mandate</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Type intent in plain English. The proxy returns schema-constrained JSON (FR-05 / FR-74). Review the
        structured form and readback, fill caps and allowlists, then sign in this browser. The LLM never signs.
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-[#f07167]/40 bg-[#f07167]/10 px-3 py-2 text-sm text-[#f07167]">
          {error}
        </p>
      ) : null}
      {issued ? <p className="mt-4 text-sm text-success">{issued}</p> : null}
      <NlMandateForm
        proxy={PROXY}
        busy={busy}
        onBusy={setBusy}
        onError={setError}
        ensureKeys={ensureKeys}
        signBody={signBody}
        onIssued={async () => {
          setIssued("Mandate issued. Signing was client-side Ed25519; the draft endpoint never signed.");
        }}
      />
    </main>
  );
}
