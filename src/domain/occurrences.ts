import { ISODateSchema, TimeSchema, inTerm, weekday, type TermWindow } from "./termCalendar";
import type { EntryInput, ValidationContext } from "./validator";
import { validateEntries } from "./validator";
import { DEFAULT_POLICY, type PolicyConfig } from "./policy";
export type OccurrenceEntry = EntryInput & {
    versionId: string;
};
export type OccurrenceException = {
    versionId: string;
    entryId: string;
    originalDate: string;
    replacementDate: string;
    replacementStart: string;
    replacementEnd: string;
};
export type Occurrence = OccurrenceEntry & {
    occurrenceKey: string;
    sourceEntryId: string;
    originalDate: string;
    actualDate: string;
    actualStart: string;
    actualEnd: string;
    rescheduled: boolean;
};
export function checkExceptions(entries: readonly OccurrenceEntry[], exceptions: readonly OccurrenceException[], term: TermWindow | null): void {
    if (exceptions.length && !term)
        throw new Error("TERM_NOT_CONFIGURED");
    const ids = new Set(entries.map(e => e.id));
    if (ids.size !== entries.length || new Set(entries.map(e => e.versionId)).size > 1)
        throw new Error("INVALID_STORED_DATA");
    const seen = new Set<string>();
    for (const e of entries)
        if (!TimeSchema.safeParse(e.start).success || !TimeSchema.safeParse(e.end).success || e.start >= e.end || !["MON", "TUE", "WED", "THU", "FRI"].includes(e.day))
            throw new Error("INVALID_STORED_DATA");
    for (const x of exceptions) {
        const e = entries.find(e => e.id === x.entryId);
        const key = JSON.stringify([x.entryId, x.originalDate]);
        if (!e || x.versionId !== e.versionId || seen.has(key) || !inTerm(x.originalDate, term) || !inTerm(x.replacementDate, term) || weekday(x.originalDate) !== e.day || !TimeSchema.safeParse(x.replacementStart).success || !TimeSchema.safeParse(x.replacementEnd).success || x.replacementStart >= x.replacementEnd || (x.originalDate === x.replacementDate && x.replacementStart === e.start && x.replacementEnd === e.end))
            throw new Error("INVALID_STORED_DATA");
        seen.add(key);
    }
}
export function materializeDate(entries: readonly OccurrenceEntry[], exceptions: readonly OccurrenceException[], date: string, term: TermWindow | null): Occurrence[] {
    ISODateSchema.parse(date);
    if (!term)
        throw new Error("TERM_NOT_CONFIGURED");
    if (!inTerm(date, term))
        throw new Error("DATE_OUT_OF_TERM");
    checkExceptions(entries, exceptions, term);
    const occurrence = (e: OccurrenceEntry, originalDate: string, start: string, end: string, moved: boolean): Occurrence => ({ ...e, id: JSON.stringify([e.versionId, e.id, originalDate]), sourceEntryId: e.id, occurrenceKey: JSON.stringify([e.versionId, e.id, originalDate]), originalDate, actualDate: date, actualStart: start, actualEnd: end, day: weekday(date), start, end, rescheduled: moved });
    const result = entries.filter(e => e.day === weekday(date) && !exceptions.some(x => x.entryId === e.id && x.originalDate === date)).map(e => occurrence(e, date, e.start, e.end, false));
    for (const x of exceptions.filter(x => x.replacementDate === date)) {
        const e = entries.find(e => e.id === x.entryId)!;
        result.push(occurrence(e, x.originalDate, x.replacementStart, x.replacementEnd, true));
    }
    return result.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
export function assessCandidate(entries: readonly OccurrenceEntry[], exceptions: readonly OccurrenceException[], context: ValidationContext, term: TermWindow | null, policy: PolicyConfig = DEFAULT_POLICY) {
    checkExceptions(entries, exceptions, term);
    const scopes = [{ date: "WEEKLY", validation: validateEntries([...entries], context, policy) }, ...[...new Set(exceptions.flatMap(x => [x.originalDate, x.replacementDate]))].sort().map(date => ({ date, validation: validateEntries(materializeDate(entries, exceptions, date, term), context, policy) }))];
    const violations = scopes.flatMap(s => s.validation.violations.map(v => ({ ...v, date: s.date })));
    return { status: scopes.some(s => s.validation.status === "incomplete") ? "INCOMPLETE" as const : violations.length ? "CONFLICTED" as const : "CLEAN" as const, violations, scopes };
}
