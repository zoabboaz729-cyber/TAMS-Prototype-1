import { type PrismaClient, type AssumptionFeedback } from "@prisma/client";
import { FeedbackSchema, type FeedbackInput } from "@/domain/assumptions";
import { canAct, type Actor } from "@/domain/permissions";
export class FeedbackError extends Error {
    constructor(public code: "FORBIDDEN" | "INVALID" | "CONFLICT") { super(code); }
}
function matches(row: AssumptionFeedback, v: FeedbackInput, role: string) {
    return row.assumptionKey === v.assumptionKey && row.verdict === v.verdict && (row.note ?? "") === v.note && (row.meetingLabel ?? "") === v.meetingLabel && row.sourceRole === v.sourceRole && row.recordedByRole === role;
}
export async function captureFeedback(db: PrismaClient, actor: Actor | null, input: unknown) {
    if (!canAct(actor, "CAPTURE_ASSUMPTION_FEEDBACK") || !actor)
        throw new FeedbackError("FORBIDDEN");
    const parsed = FeedbackSchema.safeParse(input);
    if (!parsed.success)
        throw new FeedbackError("INVALID");
    const v = parsed.data;
    const receipt = (row: AssumptionFeedback) => {
        if (!matches(row, v, actor.role))
            throw new FeedbackError("CONFLICT");
        return row;
    };
    try {
        return await db.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: actor.id } });
            if (!user || user.role !== actor.role || !user.email.endsWith("@demo.tams.test"))
                throw new FeedbackError("FORBIDDEN");
            const old = await tx.assumptionFeedback.findUnique({ where: { submissionKey: v.submissionKey } });
            if (old)
                return receipt(old);
            const row = await tx.assumptionFeedback.create({ data: { ...v, recordedByRole: actor.role } });
            await tx.auditLog.create({ data: { actorId: actor.id, action: "ASSUMPTION_FEEDBACK_CAPTURED", entity: "AssumptionFeedback", entityId: row.id } });
            return row;
        });
    }
    catch (e) {
        if (e instanceof FeedbackError)
            throw e;
        // Unique constraint and SQLite write contention can race. Reconcile only committed matching data.
        const old = await db.assumptionFeedback.findUnique({ where: { submissionKey: v.submissionKey } });
        if (old)
            return receipt(old);
        throw e;
    }
}
export async function readFindings(db: PrismaClient, actor: Actor | null) {
    if (!canAct(actor, "VIEW_ASSUMPTION_FINDINGS"))
        throw new FeedbackError("FORBIDDEN");
    return db.assumptionFeedback.findMany({ orderBy: [{ at: "asc" }, { id: "asc" }] });
}
