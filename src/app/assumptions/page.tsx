import React from "react";
import { requireAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { readFindings } from "@/server/assumptionFeedback";
import { ASSUMPTIONS, FEEDBACK_DISCLOSURE } from "@/domain/assumptions";
import { canAct } from "@/domain/permissions";
import { FlowStatus } from "@/components/FlowStatus";
import FeedbackForm from "./FeedbackForm";
import type { AssumptionFeedback } from "@prisma/client";
export const dynamic = "force-dynamic";
export default async function AssumptionsPage() {
    const actor = await requireAction("VIEW_ASSUMPTIONS"), privateAccess = canAct(actor, "VIEW_ASSUMPTION_FINDINGS");
    let rows: AssumptionFeedback[] | null = null, failed = false;
    if (privateAccess)
        try {
            rows = await readFindings(prisma, actor);
        }
        catch {
            failed = true;
        }
    return <main className="mx-auto max-w-4xl space-y-5 p-4"><h1 className="text-2xl font-bold">Assumptions and stakeholder findings</h1><p>All A1–A18 statements are unvalidated prototype assumptions. A confirmed response is a captured opinion, not a certified institutional rule.</p><p>{FEEDBACK_DISCLOSURE}</p>{privateAccess && <><p>Recorded using demo account role: {actor.role}. This is separate from the stakeholder speaking role.</p>{failed ? <FlowStatus state="ERROR" href="/assumptions" action="Retry">Findings unavailable. Check the database before recording.</FlowStatus> : <><p>{new Set(rows?.filter(r => ASSUMPTIONS.some(a => a.key === r.assumptionKey)).map(r => r.assumptionKey)).size} / 18 reviewed · {rows?.length} feedback events</p><a href="/api/assumptions/export" className="underline">Export full chronological findings CSV</a>{rows?.length === 0 && <FlowStatus state="EMPTY">No findings recorded yet.</FlowStatus>}</>}</>}{ASSUMPTIONS.map(a => { const history = rows?.filter(r => r.assumptionKey === a.key), latest = history?.at(-1); return <section key={a.key} id={a.key} className="space-y-3 rounded border p-4 break-words"><h2 className="text-lg font-bold">{a.key}: {a.text}</h2><p>UNVALIDATED · {a.tag}</p><p>Suggested discussion prompt: {a.prompt}</p>{privateAccess && !failed && <><p>Latest recorded stakeholder response: <strong>{latest?.verdict ?? "Not reviewed"}</strong></p>{history && history.length > 0 && <details><summary>Chronological history ({history.length})</summary><ol className="space-y-3">{history.map(r => <li key={r.id} className="border-l pl-3"><p>{r.at.toISOString()} · {r.verdict}{r.id === latest?.id ? " · Latest" : ""}</p><p className="whitespace-pre-wrap">{r.note || "No explanation recorded"}</p><p>Meeting: {r.meetingLabel ?? "not recorded"} · Stakeholder speaking role: {r.sourceRole ?? "not recorded"} · Recorded using demo account role: {r.recordedByRole ?? "not recorded"}</p><small>Receipt {r.id}</small></li>)}</ol></details>}<FeedbackForm assumptionKey={a.key}/></>}</section>; })}</main>;
}
