import Link from "next/link";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { readDatedTimetable } from "@/server/datedTimetable";
import { campusDateTime, DEMO_TERMS } from "@/domain/termCalendar";
export const dynamic = "force-dynamic";
export default async function DatedTimetablePage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const actor = await requireAnyAction("VIEW_TIMETABLE"); const query = await searchParams;
  const result = await readDatedTimetable(prisma,actor,Object.keys(query).length ? query : { date:campusDateTime(new Date()).date });
  return <main className="mx-auto max-w-4xl space-y-4 p-4"><h1 className="text-2xl font-bold">Schedule for a date</h1><Link href="/timetable" className="underline">Recurring weekly template</Link><p>Effective occurrences from the current publication, Africa/Nairobi (EAT). This is a plan, not proof of historical attendance.</p><p>Synthetic date window: {DEMO_TERMS.map(t => `semester ${t.semester}, ${t.startDate} to ${t.endDate}`).join("; ")}. Date-specific attendance is not implemented.</p>
    <form className="space-x-3"><label>Date <input name="date" type="date" required /></label><label>Semester <select name="semester"><option>1</option><option>2</option></select></label><button type="submit">Show schedule</button></form>
    {!result.ok ? <p role="alert">{result.message}</p> : <><h2>Schedule for {result.value.date}</h2>{result.value.rows.length === 0 && <p>No effective sessions in your authorized scope for this date.</p>}<ul>{result.value.rows.map(e => <li key={e.occurrenceKey} className="rounded border p-3">{e.unitCode} · {e.venueCode} · {e.start}–{e.end} EAT {e.rescheduled && <strong>Rescheduled occurrence (original date {e.originalDate})</strong>}</li>)}</ul></>}
  </main>;
}
