/** Synthetic demonstration calendar; never official university dates. Clock is injected. */
import { z } from "zod";
export const ISODateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, "Use a real calendar date in YYYY-MM-DD format.");
export const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const TermWindowSchema = z.object({ academicYearLabel: z.string().min(1), semester: z.union([z.literal(1), z.literal(2)]), startDate: ISODateSchema, endDate: ISODateSchema, timeZone: z.literal("Africa/Nairobi") }).strict().refine(t => t.startDate <= t.endDate);
export type TermWindow = z.infer<typeof TermWindowSchema>;
export const DEMO_TERMS: readonly TermWindow[] = [{ academicYearLabel: "Synthetic demonstration 2026", semester: 1, startDate: "2026-09-01", endDate: "2026-12-18", timeZone: "Africa/Nairobi" }];
export function termFor(semester: number): TermWindow | null { return DEMO_TERMS.find(t => t.semester === semester) ?? null; }
export function weekday(date: string): string { ISODateSchema.parse(date); return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${date}T00:00:00Z`).getUTCDay()]; }
export function inTerm(date: string, term: TermWindow | null): boolean { return term !== null && TermWindowSchema.safeParse(term).success && ISODateSchema.safeParse(date).success && date >= term.startDate && date <= term.endDate; }
export function campusDateTime(now: Date): {
    date: string;
    time: string;
} {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const v = (type: string) => parts.find(p => p.type === type)?.value;
    return { date: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}
export function hasStarted(date: string, time: string, now: Date): boolean { const clock = campusDateTime(now); return `${date}T${time}` <= `${clock.date}T${clock.time}`; }
