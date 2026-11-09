import type { AttendanceTx } from "./attendanceOccurrence";
import type { Occurrence } from "@/domain/occurrences";
import { campusDateTime } from "@/domain/termCalendar";
import { attendanceDisplay } from "@/domain/attendanceRules";
/** Public projection only: no actor/student IDs, counts, device metadata or issue allegations. */
export async function venueActivityEvidence(tx: AttendanceTx, occurrences: Occurrence[], versionId: string, now: Date) {
    const time = campusDateTime(now).time, active = occurrences.filter(o => o.actualStart <= time && time < o.actualEnd), rows = [];
    for (const o of active) {
        if (active.filter(x => x.venueId === o.venueId).length !== 1)
            continue;
        const where = { entryId_originalDate: { entryId: o.sourceEntryId, originalDate: o.originalDate } };
        const a = await tx.classOccurrenceActivity.findUnique({ where }), s = await tx.attendanceSession.findUnique({ where });
        if (a && (a.versionId !== versionId || a.actualDate !== o.actualDate || a.actualStart !== o.actualStart || a.actualEnd !== o.actualEnd || a.venueId !== o.venueId || !["REPORTED_STARTED", "REPORTED_ENDED"].includes(a.state)))
            throw new Error("INVALID_STORED_DATA");
        const session = s && !s.simulated ? s : null;
        if (session && (session.versionId !== versionId || session.actualDate !== o.actualDate || session.actualStart !== o.actualStart || session.actualEnd !== o.actualEnd))
            throw new Error("INVALID_STORED_DATA");
        rows.push({ venueId: o.venueId, activity: a?.state ?? null, attendance: attendanceDisplay(session?.status ?? null, session?.closesAt.getTime() ?? null, now.getTime()), hasMarks: session ? await tx.attendanceRecord.count({ where: { sessionId: session.id } }) > 0 : false });
    }
    return rows;
}
