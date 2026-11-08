import { describe, it, expect } from "vitest";
import { ISODateSchema, weekday, termFor, inTerm, campusDateTime } from "../termCalendar";
const term = termFor(1)!;
const x = { originalDate: "2026-11-16" };
describe("M6 calendar", () => {
    it.each(["2024-02-29", "2000-02-29", "2026-11-08"])("valid real date %s", date => expect(ISODateSchema.safeParse(date).success).toBe(true));
    it.each(["2026-02-29", "1900-02-29", "2026-13-01", "2026-04-31", "2026-1-01", "2026-11-08T00:00:00Z"])("rejects malformed date %s", date => expect(ISODateSchema.safeParse(date).success).toBe(false));
    it("derives weekday, boundaries and missing term", () => { expect(weekday(x.originalDate)).toBe("MON"); expect(inTerm(term.startDate, term)).toBe(true); expect(inTerm(term.endDate, term)).toBe(true); expect(inTerm("2027-01-01", term)).toBe(false); expect(inTerm(x.originalDate, null)).toBe(false); });
    it("uses EAT across UTC midnight", () => expect(campusDateTime(new Date("2026-11-15T22:30:00Z"))).toEqual({ date: "2026-11-16", time: "01:30" }));
});
