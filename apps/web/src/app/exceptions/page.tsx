"use client";

import Link from "next/link";
import { ExceptionsPanel } from "@/components/exceptions-panel";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://127.0.0.1:18787";

export default function ExceptionsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm font-medium text-primary">Mandate</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Exceptions</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Explain produces a prose timeline that cites every audit <code className="text-foreground">seq</code> on
        the spend request. The rows below the narrative remain the source of truth. Nothing is written back to{" "}
        <code className="text-foreground">AuditRow</code>.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/" className="text-primary hover:underline">
          Operator console
        </Link>
      </p>
      <div className="mt-8">
        <ExceptionsPanel proxy={PROXY} />
      </div>
    </main>
  );
}
