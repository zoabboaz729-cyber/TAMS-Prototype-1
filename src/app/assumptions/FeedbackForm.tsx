"use client";
import { z } from "zod";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SOURCE_ROLES } from "@/domain/assumptions";
import { FlowStatus } from "@/components/FlowStatus";
export default function FeedbackForm({ assumptionKey }: {
    assumptionKey: string;
}) {
    const router = useRouter(), key = useRef<string | null>(null), busyRef = useRef(false);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [state, setState] = useState<"EMPTY" | "SAVED" | "INVALID" | "UNKNOWN">("EMPTY"), [verdict, setVerdict] = useState("CONFIRM");
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (busyRef.current)
            return;
        busyRef.current = true;
        setBusy(true);
        setMessage("");
        const form = e.currentTarget, data = new FormData(form);
        key.current ??= crypto.randomUUID();
        try {
            const r = await fetch("/api/assumptions/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assumptionKey, verdict: data.get("verdict"), note: data.get("note"), meetingLabel: data.get("meetingLabel"), sourceRole: data.get("sourceRole"), submissionKey: key.current }) });
            if (!r.ok) {
                setState(r.status >= 500 ? "UNKNOWN" : "INVALID");
                setMessage(r.status === 409 ? "This submission key has different feedback. Check history, then choose New finding." : r.status >= 500 ? "Feedback was not confirmed saved; check your findings history before retrying." : "Feedback not saved. Check your verdict, explanation and presenter access.");
                return;
            }
            const receipt = z.object({ id: z.string().min(1), assumptionKey: z.literal(assumptionKey) }).safeParse(await r.json());
            if (!receipt.success)
                throw new Error("Unknown receipt");
            setState("SAVED");
            setMessage(`Recorded feedback for ${assumptionKey}. This is a stakeholder statement awaiting institutional validation.`);
            key.current = null;
            form.reset();
            setVerdict("CONFIRM");
            router.refresh();
        }
        catch {
            setState("UNKNOWN");
            setMessage("Feedback was not confirmed saved; check your findings history before retrying.");
        }
        finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    return <form onSubmit={submit} className="space-y-3 border-t pt-3"><fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Record a new finding for {assumptionKey}</legend><label className="block">Verdict <select name="verdict" value={verdict} onChange={e => setVerdict(e.target.value)} className="border p-2"><option value="CONFIRM">Confirm</option><option value="REJECT">Reject</option><option value="MODIFY">Modify</option></select></label><label className="block">Explanation {verdict !== "CONFIRM" ? "(required)" : "(optional)"}<textarea name="note" maxLength={2000} required={verdict !== "CONFIRM"} className="block w-full border p-2" rows={3}/></label><p>Use roles rather than personal details. Do not enter student IDs or private institutional records.</p><label className="block">Optional meeting label <input name="meetingLabel" maxLength={120} className="w-full border p-2"/></label><label className="block">Stakeholder speaking role (optional) <select name="sourceRole" className="w-full border p-2">{SOURCE_ROLES.map(r => <option key={r} value={r}>{r.replaceAll("_", " ")}</option>)}</select></label><button className="rounded border px-4 py-2" type="submit">{busy ? "Recording…" : "Record feedback"}</button> <button className="underline" type="button" onClick={() => { key.current = null; setMessage("New submission started. Check existing history to avoid duplicates."); setState("EMPTY"); }}>New finding</button></fieldset>{message && <FlowStatus state={state}>{message} <button type="button" className="underline" onClick={() => router.refresh()}>Refresh history</button></FlowStatus>}</form>;
}
