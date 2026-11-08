"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { M6Result } from "@/server/m6Errors";
/** Only the server-confirmed result may show success. No optimistic transitions. */
export default function M6Form({ action, children, label, fixed = {} }: {
    action: (input: unknown) => Promise<M6Result<unknown>>;
    children: ReactNode;
    label: string;
    fixed?: Record<string, string | boolean>;
}) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
    const router = useRouter();
    return <form className="space-y-3 rounded border p-4" onSubmit={async (event) => {
            event.preventDefault();
            if (busy)
                return;
            setBusy(true);
            setMessage("");
            const form = new FormData(event.currentTarget);
            const input: Record<string, unknown> = { ...fixed };
            for (const key of new Set(form.keys())) {
                const values = form.getAll(key);
                input[key] = values.length === 1 ? values[0] : values;
            }
            if ("override" in fixed)
                input.override = form.get("override") === "on";
            try {
                const result = await action(input);
                setMessage(result.ok ? successMessage(result.value) : result.message);
                if (result.ok)
                    router.refresh();
            }
            catch {
                setMessage("The operation could not be confirmed. Refresh and check its status before retrying.");
            }
            finally {
                setBusy(false);
            }
        }}>{children}<button disabled={busy} className="rounded bg-blue-800 p-2 text-white" type="submit">{busy ? "Saving…" : label}</button><p role="status" aria-live="polite" className="break-words">{message}</p></form>;
}
function successMessage(value: unknown): string {
    if (typeof value !== "object" || value === null)
        return "Saved and confirmed by the server.";
    const row = value as Record<string, unknown>;
    const id = typeof row.requestId === "string" ? `Request ${row.requestId}` : typeof row.issueId === "string" ? `Issue ${row.issueId}` : "Change";
    if (typeof row.draftId === "string")
        return `Draft ${row.draftId} saved. ${row.requiresRepair ? "It requires repair before publication." : "Publication is still a separate officer action."}`;
    return `${id} saved${typeof row.status === "string" ? `: ${row.status}` : ""}. Confirmed by the server.`;
}
