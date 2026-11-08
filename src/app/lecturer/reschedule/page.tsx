import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { DEMO_TERMS } from "@/domain/termCalendar";
import RescheduleForm from "./RescheduleForm";
import M6Form from "@/components/M6Form";
import { cancelRescheduleAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function ReschedulePage() {
    const actor = await requireAnyAction("REQUEST_RESCHEDULE");
    const publications = await prisma.timetableVersion.findMany({ where: { status: "PUBLISHED" }, select: { id: true, semester: true, publishedAt: true } });
    const valid = publications.filter(v => v.publishedAt && publications.filter(other => other.semester === v.semester).length === 1);
    const entries = await prisma.timetableEntry.findMany({ where: { versionId: { in: valid.map(v => v.id) }, teaching: { lecturer: { userId: actor.id } } }, include: { teaching: { include: { unit: true } } }, orderBy: { id: "asc" } });
    const history = await prisma.rescheduleRequest.findMany({ where: { requestedBy: actor.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 });
    return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-2xl font-bold">Request a reschedule</h1>
    <p>Approval creates a draft candidate only. The published timetable changes only after an officer publishes the validated draft. The original venue is retained.</p>
    <p>Africa/Nairobi (EAT), prototype campus reference zone, pending institutional confirmation. Synthetic demonstration term: {DEMO_TERMS.map(t => `${t.academicYearLabel}, semester ${t.semester}: ${t.startDate} to ${t.endDate}`).join("; ")}. Other semesters have no configured dated window.</p>
    {entries.length ? <RescheduleForm entries={entries.map(e => ({ id: e.id, label: `${e.teaching.unit.code} · ${e.day} ${e.start}–${e.end}${e.locked ? " (locked)" : ""}` }))}/> : <p>No uniquely current published classes are available for your account. Ask an officer to check the publication.</p>}
    <h2 className="text-xl font-bold">Your latest 25 requests</h2>{history.map(r => <section key={r.id} className="rounded border p-3"><p>{r.id}: {r.kind} · {r.status} · {r.originalDate} → {r.replacementDate ?? r.proposedDay} {r.proposedStart}–{r.proposedEnd}</p><p>{r.reason}</p>{r.decisionNote && <p>Decision: {r.decisionNote}</p>}{r.resultDraftVersionId && <p>Draft candidate created; approval does not mean publication.</p>}{r.status === "PENDING" && <M6Form action={cancelRescheduleAction} label="Cancel request" fixed={{ requestId: r.id }}><p>Cancellation is final.</p></M6Form>}</section>)}
  </main>;
}
