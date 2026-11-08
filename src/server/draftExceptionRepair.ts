import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { ISODateSchema, TimeSchema, hasStarted, inTerm } from "@/domain/termCalendar";
import { readM6Snapshot, assessSnapshot } from "./m6Snapshot";
import { ensure, m6Result } from "./m6Errors";
/** Repair only an existing DRAFT overlay, preserving its source occurrence. */
export function repairDraftException(client: PrismaClient, actor: Actor | null, input: unknown, now: Date) {
    return m6Result(async () => {
        ensure(actor, "UNAUTHENTICATED");
        ensure(actor.role === "OFFICER", "FORBIDDEN");
        const p = z.object({ versionId: z.string().min(1).max(100), exceptionId: z.string().min(1).max(100), expectedFingerprint: z.string().length(64), replacementDate: ISODateSchema, replacementStart: TimeSchema, replacementEnd: TimeSchema, note: z.string().trim().min(10).max(500) }).strict().safeParse(input);
        ensure(p.success, "INVALID_INPUT");
        const d = p.data;
        return client.$transaction(async (tx) => {
            const s = await readM6Snapshot(tx, d.versionId);
            ensure(s.version.status === "DRAFT", "NOT_DRAFT");
            ensure(s.fingerprint === d.expectedFingerprint, "STALE");
            const x = s.exceptions.find(x => x.id === d.exceptionId);
            ensure(x, "SOURCE_NOT_FOUND");
            const entry = s.entries.find(e => e.id === x.entryId);
            ensure(entry, "INVALID_STORED_DATA");
            ensure(!hasStarted(x.originalDate, entry.start, now) && !hasStarted(x.replacementDate, x.replacementStart, now) && !hasStarted(d.replacementDate, d.replacementStart, now), "PAST_OCCURRENCE");
            ensure(inTerm(d.replacementDate, s.term), "DATE_OUT_OF_TERM");
            const exceptions = s.exceptions.map(e => e.id === x.id ? { ...e, replacementDate: d.replacementDate, replacementStart: d.replacementStart, replacementEnd: d.replacementEnd } : e);
            const assessment = assessSnapshot(s, s.entries, exceptions);
            ensure(assessment.status !== "INCOMPLETE", "INCOMPLETE_VALIDATION");
            const changed = await tx.timetableOccurrenceException.updateMany({ where: { id: x.id, versionId: s.version.id, replacementDate: x.replacementDate, replacementStart: x.replacementStart, replacementEnd: x.replacementEnd }, data: { replacementDate: d.replacementDate, replacementStart: d.replacementStart, replacementEnd: d.replacementEnd } });
            ensure(changed.count === 1, "STALE");
            await tx.auditLog.create({ data: { actorId: actor.id, action: "DRAFT_EXCEPTION_REPAIRED", entity: "TimetableOccurrenceException", entityId: x.id, reason: d.note } });
            return { draftId: s.version.id, requiresRepair: assessment.status !== "CLEAN" };
        });
    });
}
