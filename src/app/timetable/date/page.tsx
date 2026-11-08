import Link from "next/link";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { readDatedTimetable } from "@/server/datedTimetable";
import { loadTimetableOptions } from "@/server/publishedTimetableOptions";
import { createPublishedTimetableStore } from "@/server/publishedTimetableStorePrisma";
import { campusDateTime, DEMO_TERMS, ISODateSchema } from "@/domain/termCalendar";
export const dynamic = "force-dynamic";
export default async function DatedTimetablePage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await requireAnyAction("VIEW_TIMETABLE");
    const query = await searchParams;
    const result = await readDatedTimetable(prisma, actor, Object.keys(query).length ? query : { date: campusDateTime(new Date()).date });
    const semester=query.semester === "2" ? 2 : 1;
    const options=await loadTimetableOptions(createPublishedTimetableStore(prisma),actor,semester);
    const date=typeof query.date === "string" && ISODateSchema.safeParse(query.date).success ? query.date : campusDateTime(new Date()).date;
    const views=[{view:"group",label:"Student group",choices:options.groups.map(g=>({id:g.id,label:g.name}))},{view:"lecturer",label:"Lecturer",choices:options.lecturers.map(l=>({id:l.id,label:l.displayName}))},{view:"venue",label:"Venue",choices:options.venues.map(v=>({id:v.id,label:v.code}))}];
    return <main className="mx-auto max-w-4xl space-y-4 p-4"><h1 className="text-2xl font-bold">Schedule for a date</h1><Link href="/timetable" className="underline">Recurring weekly template</Link><p>Effective occurrences from the current publication, Africa/Nairobi (EAT). This is a plan, not proof of historical attendance.</p><p>Synthetic date window: {DEMO_TERMS.map(t => `semester ${t.semester}, ${t.startDate} to ${t.endDate}`).join("; ")}. Date-specific attendance is not implemented.</p>
    <form className="space-x-3"><label>Date <input name="date" type="date" required/></label><label>Semester <select name="semester"><option>1</option><option>2</option></select></label><button type="submit">Show schedule</button></form>
    <section aria-label="Authorized date perspectives" className="space-y-3">{views.filter(v=>v.choices.length).map(v=><form key={v.view} className="flex flex-wrap gap-3 rounded border p-3"><input type="hidden" name="date" value={date}/><input type="hidden" name="semester" value={semester}/><input type="hidden" name="view" value={v.view}/><label>{v.label}<select name="id">{v.choices.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button type="submit">Show selected {v.label.toLowerCase()}</button></form>)}</section>
    {!result.ok ? <p role="alert">{result.message}</p> : <><h2>Schedule for {result.value.date}</h2>{result.value.rows.length === 0 && <p>No effective sessions in your authorized scope for this date.</p>}<ul>{result.value.rows.map(e => <li key={e.occurrenceKey} className="rounded border p-3">{e.unitCode} · {e.groupName} · {e.venueCode} · {e.start}–{e.end} EAT {e.rescheduled && <strong>Rescheduled occurrence (original date {e.originalDate})</strong>}</li>)}</ul></>}
  </main>;
}
