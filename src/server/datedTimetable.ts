import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { decideAnyAccess } from "@/domain/access";
import type { Actor } from "@/domain/permissions";
import { timetableAccess, canReadTimetableEntry, canSelectTimetable } from "@/domain/publishedTimetableAccess";
import { materializeDate } from "@/domain/occurrences";
import { ISODateSchema, inTerm } from "@/domain/termCalendar";
import { readM6Snapshot } from "./m6Snapshot";
import { ensure, m6Result } from "./m6Errors";
export function readDatedTimetable(client: PrismaClient, actor: Actor | null, input: unknown) {
    return m6Result(async () => {
        ensure(actor, "UNAUTHENTICATED");
        ensure(decideAnyAccess(actor, "VIEW_TIMETABLE").status === "ALLOW", "FORBIDDEN");
        const p = z.object({ date: ISODateSchema, semester: z.enum(["1", "2"]).default("1"), view: z.enum(["group", "lecturer", "venue"]).optional(), id: z.string().min(1).max(100).optional() }).strict().safeParse(input);
        ensure(p.success, "INVALID_INPUT");
        const q = p.data;
        return client.$transaction(async (tx) => {
            const groups = await tx.studentGroup.findMany({ where: actor.role === "STUDENT" ? { id: actor.studentGroupId ?? "" } : actor.role === "DEPT_REP" || actor.role === "APPROVER" ? { departmentId: actor.departmentId ?? "" } : {} });
            const lecturers = await tx.lecturer.findMany({ where: actor.role === "LECTURER" ? { userId: actor.id } : {} });
            const teachings = await tx.teaching.findMany();
            const access = timetableAccess(actor, groups, lecturers, teachings);
            if (actor.role === "STUDENT")
                ensure(access.groupIds.length, "IDENTITY_UNRESOLVED");
            if (actor.role === "LECTURER")
                ensure(access.lecturerIds.length, "IDENTITY_UNRESOLVED");
            if (["DEPT_REP", "APPROVER"].includes(actor.role))
                ensure(actor.departmentId, "IDENTITY_UNRESOLVED");
            ensure(!q.id || q.view, "INVALID_INPUT");
            if (q.view)
                ensure(q.id && canSelectTimetable(access, q.view, q.id), "FORBIDDEN");
            const versions = await tx.timetableVersion.findMany({ where: { semester: Number(q.semester), status: "PUBLISHED" } });
            ensure(versions.length, "NO_PUBLICATION");
            ensure(versions.length === 1, "AMBIGUOUS_PUBLICATION");
            ensure(versions[0].publishedAt, "INVALID_STORED_DATA");
            const s = await readM6Snapshot(tx, versions[0].id);
            ensure(s.term, "TERM_NOT_CONFIGURED");
            ensure(inTerm(q.date, s.term), "DATE_OUT_OF_TERM");
            const occurrences = materializeDate(s.entries, s.exceptions, q.date, s.term);
            const authorized = occurrences.filter(e => { const t = teachings.find(t => t.id === e.teachingId); ensure(t, "INVALID_STORED_DATA"); return canReadTimetableEntry(access, actor, t) && (!q.view || (q.view === "group" ? t.groupId === q.id : q.view === "lecturer" ? t.lecturerId === q.id : e.venueId === q.id)); });
            return { date: q.date, versionId: s.version.id, rows: authorized.map(e => { const t = s.teachings.find(t => t.id === e.teachingId)!; const v = s.venues.find(v => v.id === e.venueId); ensure(v, "INVALID_STORED_DATA"); const group=groups.find(g=>g.id===t.groupId);ensure(group,"INVALID_STORED_DATA"); return { occurrenceKey: e.occurrenceKey, unitCode: t.unit.code, groupName:group.name, venueCode: v.code, start: e.start, end: e.end, rescheduled: e.rescheduled, originalDate: e.originalDate }; }) };
        });
    });
}
