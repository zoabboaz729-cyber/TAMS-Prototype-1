import Link from "next/link";
import { requireAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { reviewReschedule } from "@/server/rescheduleService";
import M6Form from "@/components/M6Form";
import { decideRescheduleAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function ReschedulesPage() {
    const actor = await requireAction("DECIDE_RESCHEDULE");
    const requests = await prisma.rescheduleRequest.findMany({ include: { entry: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 });
    return <main className="mx-auto max-w-5xl space-y-4 p-4"><h1 className="text-2xl font-bold">Reschedule requests</h1><p>Latest 25 requests. Approval creates a new DRAFT; publication remains a separate validated M4 action. Conflict overrides create repair drafts only.</p>
    {requests.map(async (r) => {
            const preview = r.status === "PENDING" ? await reviewReschedule(prisma, actor, r.id, new Date()) : null;
            return <section key={r.id} className="space-y-3 rounded border p-4"><h2 className="text-lg font-bold">{r.kind} · {r.status}</h2><p>{r.id} · Source: {r.entry.day} {r.entry.start}–{r.entry.end} · {r.originalDate ?? "Recurring weekly"} → {r.replacementDate ?? r.proposedDay} {r.proposedStart}–{r.proposedEnd}</p><p>{r.reason}</p>
        {r.resultDraftVersionId && <Link className="underline" href={`/officer/draft?version=${r.resultDraftVersionId}`}>Open produced draft {r.resultDraftVersionId}</Link>}
        {preview && (!preview.ok ? <p role="alert">{preview.message}</p> : <><p>Candidate: {preview.value.assessment.status}. Existing baseline: {preview.value.baseline.status}.</p>
          <details><summary>Baseline problems</summary><ul>{preview.value.baseline.violations.map((v, i) => <li key={i}>{v.date}: {v.message}</li>)}</ul></details>
          <ul>{preview.value.assessment.violations.map((v, i) => <li key={i}>{v.date}: {v.type} — {v.message}</li>)}{preview.value.assessment.operationalProblems.map(v => <li key={v}>{v}</li>)}</ul>
          <M6Form action={decideRescheduleAction} label="Confirm decision" fixed={{ requestId: r.id, expectedReviewToken: preview.value.token, override: false }}>
            <label className="block">Decision <select name="decision"><option value="APPROVE">Approve creation of draft</option><option value="REJECT">Reject request</option></select></label>
            <label className="block"><input type="checkbox" name="override"/> Explicitly approve a conflicted repair draft</label>
            <label className="block">Decision note (at least 10 characters for rejection or override) <textarea className="block w-full border" name="note" maxLength={500}/></label>
          </M6Form></>)}
      </section>;
        })}
  </main>;
}
