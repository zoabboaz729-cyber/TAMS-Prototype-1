import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "@/domain/permissions";
import { ISODateSchema } from "@/domain/termCalendar";
import { attendanceActor } from "./attendanceOccurrence";
import { attendanceResult, refuse } from "./attendanceErrors";
export const ReportQuery = z.object({ sessionId: z.string().min(1).max(150).optional(), unitId: z.preprocess(v => v === "" ? undefined : v, z.string().min(1).max(150).optional()), from: z.preprocess(v => v === "" ? undefined : v, ISODateSchema.optional()), to: z.preprocess(v => v === "" ? undefined : v, ISODateSchema.optional()), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().refine(q => !q.from || !q.to || q.from <= q.to);
export function reportScope(actor: Actor): Prisma.AttendanceSessionWhereInput {
    switch (actor.role) {
        case "OFFICER": return {};
        case "LECTURER": return { entry: { teaching: { lecturer: { userId: actor.id } } } };
        case "DEPT_REP":
        case "APPROVER":
            if (!actor.departmentId)
                refuse("FORBIDDEN");
            return { entry: { teaching: { group: { departmentId: actor.departmentId } } } };
        case "STUDENT": return { records: { some: { studentId: actor.id } } };
        default: refuse("FORBIDDEN");
    }
}
export async function attendanceReports(db: PrismaClient, actor: Actor | null, input: unknown = {}) {
    return attendanceResult(() => db.$transaction(async (tx) => {
        const user = await attendanceActor(tx, actor);
        const scope = reportScope(user);
        const parsed = ReportQuery.safeParse(input);
        if (!parsed.success)
            refuse("INVALID_INPUT");
        const q = parsed.data;
        const where: Prisma.AttendanceSessionWhereInput = { AND: [scope, { ...(q.sessionId ? { id: q.sessionId } : {}), ...(q.unitId ? { entry: { teaching: { unitId: q.unitId } } } : {}), ...(q.from || q.to ? { actualDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}) }] };
        const all = await tx.attendanceSession.findMany({ where, orderBy: [{ actualDate: "desc" }, { id: "asc" }], include: { entry: { include: { teaching: { include: { unit: true, group: true, lecturer: true } }, venue: true } }, records: { where: user.role === "STUDENT" ? { studentId: user.id } : {}, select: { id: true, studentId: true, recordedAt: true, student: { select: { name: true } } }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } } });
        if (q.sessionId && !all.length)
            refuse("NOT_FOUND");
        const rows = [];
        for (const s of all.slice((q.page - 1) * 25, q.page * 25)) {
            const t = s.entry.teaching, activity = s.originalDate ? await tx.classOccurrenceActivity.findUnique({ where: { entryId_originalDate: { entryId: s.entryId, originalDate: s.originalDate } } }) : null;
            const ownStudent = user.role === "STUDENT";
            const accounts = ownStudent ? null : await tx.user.count({ where: { role: "STUDENT", studentGroupId: t.groupId } });
            rows.push({ id: s.id, unit: t.unit.code, unitId: t.unitId, departmentId: t.group.departmentId, group: t.group.name, venue: s.entry.venue.code, date: s.actualDate, originalDate: s.originalDate, start: s.actualStart, end: s.actualEnd, status: s.status, simulated: s.simulated, marks: s.records.length, plannedGroupSize: ownStudent ? null : t.group.size, provisionedAccounts: accounts, activity: activity?.state ?? null, startedAt: activity?.startedAt.toISOString() ?? null, endedAt: activity?.endedAt?.toISOString() ?? null, records: user.role === "LECTURER" || ownStudent ? s.records.map(r => ({ id: r.id, name: ownStudent ? "Your attendance" : r.student.name, at: r.recordedAt.toISOString() })) : [] });
        }
        // Full-scope totals computed independently of page size; never sum distinct participants per row.
        const unitTotals = new Map<string, {
            unit: string;
            simulated: boolean;
            marks: number;
            sessions: number;
            participants: Set<string>;
        }>();
        for (const s of all) {
            const k = `${s.entry.teaching.unitId}:${s.simulated}`;
            const a = unitTotals.get(k) ?? { unit: s.entry.teaching.unit.code, simulated: s.simulated, marks: 0, sessions: 0, participants: new Set<string>() };
            a.marks += s.records.length;
            a.sessions++;
            s.records.forEach(r => a.participants.add(r.studentId));
            unitTotals.set(k, a);
        }
        const activityScope: Prisma.ClassOccurrenceActivityWhereInput = user.role === "LECTURER" ? { entry: { teaching: { lecturer: { userId: user.id } } } } : user.role === "DEPT_REP" || user.role === "APPROVER" ? { entry: { teaching: { group: { departmentId: user.departmentId! } } } } : {};
        const activityWhere: Prisma.ClassOccurrenceActivityWhereInput = { AND: [activityScope, { ...(q.unitId ? { entry: { teaching: { unitId: q.unitId } } } : {}), ...(q.from || q.to ? { actualDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}) }] };
        const activityRows = user.role === "STUDENT" || q.sessionId ? [] : await tx.classOccurrenceActivity.findMany({ where: activityWhere, orderBy: [{ actualDate: "desc" }, { id: "asc" }], skip: (q.page - 1) * 25, take: 25, include: { teaching: { include: { unit: true, group: true } }, venue: true } });
        const totalActivities = user.role === "STUDENT" || q.sessionId ? 0 : await tx.classOccurrenceActivity.count({ where: activityWhere });
        const activities = activityRows.map(a => ({ id: a.id, unit: a.teaching.unit.code, group: a.teaching.group.name, venue: a.venue.code, date: a.actualDate, originalDate: a.originalDate, start: a.actualStart, end: a.actualEnd, state: a.state, startedAt: a.startedAt.toISOString(), endedAt: a.endedAt?.toISOString() ?? null }));
        return { activities, totalActivities, rows, page: q.page, totalSessions: all.length, totalPages: Math.ceil(Math.max(all.length, totalActivities) / 25), totals: [...unitTotals.values()].map(a => ({ unit: a.unit, simulated: a.simulated, marks: a.marks, sessions: a.sessions, distinctParticipants: a.participants.size })), scope: user.role === "STUDENT" ? "Your confirmed marks only" : user.role === "LECTURER" ? "Your classes" : "Authorized department/group aggregates" };
    }));
}
export async function attendanceSummary(db: PrismaClient, actor: Actor | null, id: string) {
    return attendanceResult(() => db.$transaction(async (tx) => {
        const user = await attendanceActor(tx, actor);
        if (user.role === "STUDENT")
            refuse("FORBIDDEN");
        const s = await tx.attendanceSession.findFirst({ where: { AND: [{ id }, reportScope(user)] }, select: { id: true, status: true, closesAt: true, simulated: true, _count: { select: { records: true } } } });
        if (!s)
            refuse("NOT_FOUND");
        return { sessionId: s.id, status: s.status, closesAt: s.closesAt.toISOString(), count: s._count.records, simulated: s.simulated };
    }));
}
