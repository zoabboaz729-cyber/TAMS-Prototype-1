"use client";
import { z } from "zod";
import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { FlowStatus } from "@/components/FlowStatus";
export default function ResetDemoForm() {
    const router = useRouter(), lock = useRef(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [state, setState] = useState<"SAVED" | "UNKNOWN">("UNKNOWN");
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (lock.current)
            return;
        const form = e.currentTarget, confirmation = new FormData(form).get("confirmation");
        if (!window.confirm("Restore only synthetic operational data? All findings and capture audits will be retained."))
            return;
        lock.current = true;
        setBusy(true);
        try {
            const r = await fetch("/api/demo/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) });
            if (!r.ok || !z.object({ ok: z.literal(true) }).safeParse(await r.json()).success)
                throw new Error();
            setState("SAVED");
            form.reset();
            router.push("/demo?reset=retained");
            router.refresh();
            setMessage("Operational sample data restored. All findings and capture audits retained.");
        }
        catch {
            setState("UNKNOWN");
            setMessage("Reset was not confirmed. Refresh readiness and findings before retrying.");
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <form onSubmit={submit} className="space-y-3 rounded border border-red-400 p-4"><h2 className="font-bold">Restore disposable sample data</h2><p>Clears generated/published schedules, reschedules, attendance marks/sessions, class reports, submissions, issue changes and operational audits. Restores the original conflicted DRAFT. Seeded user identities, all findings and their capture audits are retained.</p><label className="block">Type RESET SAMPLE DATA <input name="confirmation" required pattern="RESET SAMPLE DATA" autoComplete="off" className="border p-2" disabled={busy}/></label><button disabled={busy} className="rounded border px-4 py-2">{busy ? "Restoring…" : "Confirm reset"}</button>{message && <FlowStatus state={state}>{message}</FlowStatus>}</form>;
}
