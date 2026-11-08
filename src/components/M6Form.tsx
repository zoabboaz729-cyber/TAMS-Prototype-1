"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { M6Result } from "@/server/m6Errors";
/** Only the server-confirmed result may show success. No optimistic transitions. */
export default function M6Form({ action, children, label, fixed = {} }: { action: (input: unknown) => Promise<M6Result<unknown>>; children: ReactNode; label: string; fixed?: Record<string,string|boolean> }) {
  const [busy,setBusy] = useState(false), [message,setMessage] = useState(""); const router = useRouter();
  return <form className="space-y-3 rounded border p-4" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const input: Record<string,unknown> = { ...fixed };
    for (const key of new Set(form.keys())) { const values = form.getAll(key); input[key] = values.length === 1 ? values[0] : values; }
    if ("override" in fixed) input.override = form.get("override") === "on";
    try { const result = await action(input); setMessage(result.ok ? `Saved. ${JSON.stringify(result.value)}` : result.message); if (result.ok) router.refresh(); }
    catch { setMessage("The operation could not be confirmed. Refresh and check its status before retrying."); }
    finally { setBusy(false); }
  }}>{children}<button disabled={busy} className="rounded bg-blue-800 p-2 text-white" type="submit">{busy ? "Saving…" : label}</button><p role="status" aria-live="polite" className="break-words">{message}</p></form>;
}
