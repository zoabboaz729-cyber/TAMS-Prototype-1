import React from "react";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { attendanceReports } from "@/server/attendanceReports";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function AttendanceReportPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await requireAnyAction("VIEW_ATTENDANCE_REPORT"), query = await searchParams;
    const r = await attendanceReports(prisma, actor, query);
    return <main className="mx-auto max-w-5xl space-y-5 p-4"><h1 className="text-2xl font-bold">Attendance reports</h1><p>Prototype — sample data. Not official university records.</p><p>Stored confirmations and lecturer-reported activity are separate facts. Neither independently verifies physical presence. Planned group size is not verified enrolment; no official attendance rate is calculated.</p>
 <form className="flex flex-wrap gap-3 rounded border p-3"><label>From date <input name="from" type="date" className="border"/></label><label>To date <input name="to" type="date" className="border"/></label><label>Unit ID <input name="unitId" className="border"/></label><button type="submit" className="rounded border px-3 py-1">Filter</button><a className="underline" href="/reports/attendance">Clear filters</a></form>
 {!r.ok ? <p role="alert">{r.message}</p> : <><p>{r.value.scope} · {r.value.totalSessions} session(s).</p><div className="overflow-x-auto"><table className="w-full border-collapse text-left"><caption>Totals across all authorized filtered sessions, independent of pagination</caption><thead><tr><th>Unit / mode</th><th>Sessions</th><th>Stored marks</th><th>Distinct participants</th></tr></thead><tbody>{r.value.totals.map(t => <tr key={`${t.unit}:${t.simulated}`}><td>{t.unit} · {t.simulated ? "SIMULATION" : "Live"}</td><td>{t.sessions}</td><td>{t.marks}</td><td>{t.distinctParticipants}</td></tr>)}</tbody></table></div>
 {r.value.rows.length === 0 && <p>No stored attendance matches these filters.</p>}{r.value.rows.map(s => <section key={s.id} className="space-y-2 rounded border p-4"><h2 className="text-lg font-semibold">{s.unit} · {s.group} · {s.venue}{s.simulated ? " · SYNTHETIC SIMULATION" : ""}</h2><p>{s.date ?? "Legacy record — occurrence date needs explicit repair"} {s.start}–{s.end} EAT{s.originalDate && s.originalDate !== s.date && ` (original date ${s.originalDate})`}</p><p>Attendance stored state: {s.status}; confirmed marks: {s.marks}. Class activity: {s.activity ?? "No class-start report recorded"}.</p><p>Reported start: {s.startedAt ?? "not reported"}; reported end: {s.endedAt ?? "not reported"}.</p>{s.provisionedAccounts !== null && <p>Provisioned demo student accounts: {s.provisionedAccounts}; planned group size: {s.plannedGroupSize}. These are different quantities.</p>}{s.records.length > 0 && <ul>{s.records.map(row => <li key={row.id}>{row.name} · confirmed {row.at} · receipt {row.id}</li>)}</ul>}</section>)}
 <section className="space-y-3"><h2 className="text-xl font-semibold">Independent class-activity reports ({r.value.totalActivities})</h2><p>These reports can exist without any attendance session. No reported start is not an absence verdict.</p>{r.value.activities.map(a => <article key={a.id} className="rounded border p-3"><h3>{a.unit} · {a.group} · {a.venue}</h3><p>{a.date} {a.start}–{a.end} EAT · {a.state}; start reported {a.startedAt}; end {a.endedAt ?? "not reported"}.</p></article>)}</section>
 <nav aria-label="Report pages" className="flex gap-3">{Array.from({ length: r.value.totalPages }, (_, i) => i + 1).filter(p => Math.abs(p - r.value.page) <= 2).map(p => { const params = new URLSearchParams(); for (const [k, v] of Object.entries(query))
            if (typeof v === "string" && k !== "page")
                params.set(k, v); params.set("page", String(p)); return <a key={p} className="underline" href={`?${params}`} aria-current={p === r.value.page ? "page" : undefined}>Page {p}</a>; })}</nav></>}
 </main>;
}
