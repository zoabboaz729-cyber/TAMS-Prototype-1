import type { PrismaClient } from "@prisma/client";
import { materializeDate } from "@/domain/occurrences";
import { campusDateTime } from "@/domain/termCalendar";
import { attendanceDisplay } from "@/domain/attendanceRules";
import type { Actor } from "@/domain/permissions";
import { attendanceActor, resolveAttendanceOccurrence, operationalAttendance } from "./attendanceOccurrence";
import { attendanceResult, refuse } from "./attendanceErrors";
import { readM6Snapshot } from "./m6Snapshot";
import type { AttendanceRuntime } from "./attendanceRuntime";
export async function lecturerAttendanceList(db: PrismaClient, actor: Actor | null, runtime: AttendanceRuntime, semester = 1) {
    return attendanceResult(() => db.$transaction(async (tx) => {
        const user = await attendanceActor(tx, actor);
        if (user.role !== "LECTURER")
            refuse("FORBIDDEN");
        const pubs = await tx.timetableVersion.findMany({ where: { semester, status: "PUBLISHED" } });
        if (pubs.length !== 1 || !pubs[0].publishedAt)
            refuse("STALE_PUBLICATION");
        const s = await readM6Snapshot(tx, pubs[0].id);
        if (!s.term)
            refuse("TERM_NOT_CONFIGURED");
        const date = campusDateTime(runtime.now).date;
        let all;
        try {
            all = materializeDate(s.entries, s.exceptions, date, s.term);
        }
        catch {
            refuse("OCCURRENCE_NOT_EFFECTIVE");
        }
        const rows = [];
        for (const o of all) {
            const t = s.teachings.find(t => t.id === o.teachingId);
            if (t?.lecturer.userId !== user.id)
                continue;
            const r = await resolveAttendanceOccurrence(tx, { sourceEntryId: o.sourceEntryId, originalDate: o.originalDate });
            let operational = true;
            try {
                operationalAttendance(r);
            }
            catch {
                operational = false;
            }
            const where = { entryId_originalDate: { entryId: o.sourceEntryId, originalDate: o.originalDate } };
            const activity = await tx.classOccurrenceActivity.findUnique({ where });
            const session = await tx.attendanceSession.findUnique({ where });
            rows.push({ sourceEntryId: o.sourceEntryId, originalDate: o.originalDate, actualDate: o.actualDate, start: o.actualStart, end: o.actualEnd, unit: t.unit.code, group: r.entry.teaching.group.name, venue: r.entry.venue.code, activity: activity?.state ?? null, startedAt: activity?.startedAt.toISOString() ?? null, endedAt: activity?.endedAt?.toISOString() ?? null, sessionId: session?.id ?? null, sessionStatus: attendanceDisplay(session?.status ?? null, session?.closesAt.getTime() ?? null, runtime.now.getTime()), simulated: session?.simulated ?? runtime.simulated, inWindow: operational && r.starts <= runtime.now.getTime() && runtime.now.getTime() < r.ends, realStartAllowed: operational && r.starts <= runtime.realNow.getTime() && runtime.realNow.getTime() < r.ends });
        }
        return { rows, date, simulated: runtime.simulated };
    }));
}
export async function studentAttendanceList(db: PrismaClient, actor: Actor | null, runtime: AttendanceRuntime) {
    return attendanceResult(() => db.$transaction(async (tx) => {
        const user = await attendanceActor(tx, actor);
        if (user.role !== "STUDENT" || !user.studentGroupId)
            refuse("FORBIDDEN");
        const sessions = await tx.attendanceSession.findMany({ where: { status: "OPEN", simulated: runtime.simulated, entry: { teaching: { groupId: user.studentGroupId } }, opensAt: { lte: runtime.now }, closesAt: { gt: runtime.now } }, orderBy: [{ scanFrom: "asc" }, { id: "asc" }] });
        const rows = [];
        for (const session of sessions) {
            if (!session.originalDate || !session.versionId)
                refuse("INVALID_STORED_DATA");
            const entry = await tx.timetableEntry.findUniqueOrThrow({ where: { id: session.entryId }, include: { version: true } });
            if (entry.version.status !== "PUBLISHED")
                continue;
            const r = await resolveAttendanceOccurrence(tx, { sourceEntryId: session.entryId, originalDate: session.originalDate });
            operationalAttendance(r);
            const activity = await tx.classOccurrenceActivity.findUnique({ where: { entryId_originalDate: { entryId: session.entryId, originalDate: session.originalDate } } });
            if (activity?.state === "REPORTED_ENDED")
                continue;
            const recorded = await tx.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: user.id } } });
            rows.push({ id: session.id, unit: r.entry.teaching.unit.code, venue: r.entry.venue.code, date: r.occurrence.actualDate, start: r.occurrence.actualStart, end: r.occurrence.actualEnd, scanFrom: session.scanFrom.toISOString(), closesAt: session.closesAt.toISOString(), recorded: !!recorded, simulated: session.simulated });
        }
        return rows;
    }));
}
