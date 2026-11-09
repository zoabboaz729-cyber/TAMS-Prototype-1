import { FlowStatus } from "@/components/FlowStatus";
import React from "react";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { lecturerAttendanceList } from "@/server/attendanceReads";
import { attendanceRuntime } from "@/server/attendanceRuntime";
import { attendanceTransport } from "@/server/attendanceHttp";
import AttendanceControls from "./AttendanceControls";
import AttendanceQr from "./AttendanceQr";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function LecturerAttendancePage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await requireAnyAction("OPEN_ATTENDANCE");
    const query = await searchParams;
    const r = await attendanceTransport(async () => lecturerAttendanceList(prisma, actor, attendanceRuntime(), query.semester === "2" ? 2 : 1));
    return <main className="mx-auto max-w-4xl space-y-5 p-4"><h1 className="text-2xl font-bold">Class activity and attendance</h1><p>Prototype — sample data. Not official university records.</p><p>Start class and Open attendance are independent. Reported activity does not release a venue reservation or independently verify presence.</p><nav><a className="underline" href="?semester=1">Semester 1</a>{" · "}<a className="underline" href="?semester=2">Semester 2</a>{" · "}<a className="underline" href="/reports/attendance">Attendance history</a></nav>
 {!r.ok ? <FlowStatus state={r.code === "INTERNAL_ERROR" ? "ERROR" : r.code === "INVALID_INPUT" ? "INVALID" : "NOT_READY"}>{r.message}</FlowStatus> : <><p>{r.value.date} · Africa/Nairobi{r.value.simulated ? " · SYNTHETIC QR SIMULATION (class activity still uses real time)" : " · Live server time"}</p>{r.value.rows.length === 0 && <FlowStatus state="EMPTY" href="/timetable/date" action="Check term/date and publication">No assigned effective published classes for this date. Check the published timetable.</FlowStatus>}{r.value.rows.map(o => <section key={`${o.sourceEntryId}:${o.originalDate}`} className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">{o.unit} · {o.group} · Assigned venue {o.venue}</h2><p>{o.actualDate} {o.start}–{o.end} EAT {o.originalDate !== o.actualDate && `(moved from ${o.originalDate})`}</p><p>Class activity: {o.activity ?? "No class-start report recorded"}. Attendance: {o.sessionStatus}.</p>{o.startedAt && <p>Start reported {o.startedAt}; end {o.endedAt ?? "not reported"}.</p>}{o.activity === "REPORTED_ENDED" && o.sessionStatus === "OPEN" && <p>Attendance still open, but scanning stopped because class end was reported; close attendance separately.</p>}
 <AttendanceControls {...o}/>{o.sessionId && o.sessionStatus === "OPEN" && o.activity !== "REPORTED_ENDED" && <AttendanceQr sessionId={o.sessionId}/>}</section>)}</>}
 </main>;
}
