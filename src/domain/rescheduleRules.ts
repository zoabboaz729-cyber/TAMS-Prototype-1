import { z } from "zod";
import { ISODateSchema, TimeSchema, hasStarted, inTerm, weekday, type TermWindow } from "./termCalendar";
import type { OccurrenceEntry, OccurrenceException } from "./occurrences";
const common = { sourceEntryId: z.string().trim().min(1).max(100), proposedStart: TimeSchema, proposedEnd: TimeSchema, reason: z.string().trim().min(10).max(500) };
export const RescheduleSubmitSchema = z.discriminatedUnion("kind", [
    z.object({ ...common, kind: z.literal("WEEKLY"), proposedDay: z.enum(["MON", "TUE", "WED", "THU", "FRI"]) }).strict(),
    z.object({ ...common, kind: z.literal("ONE_OFF"), originalDate: ISODateSchema, replacementDate: ISODateSchema }).strict(),
]);
export const RescheduleDecisionSchema = z.object({ requestId: z.string().min(1).max(100), decision: z.enum(["APPROVE", "REJECT"]), override: z.boolean(), note: z.string().trim().max(500), expectedReviewToken: z.string().length(64) }).strict();
export type RescheduleProposal = z.infer<typeof RescheduleSubmitSchema>;
export function proposalProblem(p: RescheduleProposal, source: OccurrenceEntry & {
    locked: boolean;
}, exceptions: readonly OccurrenceException[], term: TermWindow | null, now: Date): string | null {
    if (source.locked)
        return "LOCKED";
    if (p.proposedStart >= p.proposedEnd)
        return "INVALID_INPUT";
    if (p.kind === "WEEKLY") {
        if (exceptions.some(e => e.entryId === source.id))
            return "EXCEPTIONS_REQUIRE_REVIEW";
        if (p.proposedDay === source.day && p.proposedStart === source.start && p.proposedEnd === source.end)
            return "NO_CHANGE";
    }
    else {
        if (!term)
            return "TERM_NOT_CONFIGURED";
        if (!inTerm(p.originalDate, term) || !inTerm(p.replacementDate, term))
            return "DATE_OUT_OF_TERM";
        if (weekday(p.originalDate) !== source.day)
            return "INVALID_INPUT";
        if (exceptions.some(e => e.entryId === source.id && e.originalDate === p.originalDate))
            return "ALREADY_OVERRIDDEN";
        if (hasStarted(p.originalDate, source.start, now) || hasStarted(p.replacementDate, p.proposedStart, now))
            return "PAST_OCCURRENCE";
        if (p.originalDate === p.replacementDate && p.proposedStart === source.start && p.proposedEnd === source.end)
            return "NO_CHANGE";
    }
    return null;
}
