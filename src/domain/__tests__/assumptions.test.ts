import { it, expect } from "vitest";
import { ASSUMPTIONS, FeedbackSchema } from "../assumptions";
import { findingsCsv, csvCell, CSV_HEADER } from "../findingsCsv";
it("exact canonical ordered registry", () => { expect(ASSUMPTIONS.map(a => a.key)).toEqual(Array.from({ length: 18 }, (_, i) => `A${i + 1}`)); expect(new Set(ASSUMPTIONS.map(a => a.tag)).size).toBe(18); expect(ASSUMPTIONS[15].text).toContain("SOEN 321"); });
const base = { assumptionKey: "A1", verdict: "CONFIRM", submissionKey: "b1c89b22-4879-48a9-bd08-d6aaf8e41404" };
it("strict bounded inputs", () => {
    expect(FeedbackSchema.safeParse(base).success).toBe(true);
    for (const v of [{ assumptionKey: "A19" }, { verdict: "REJECT" }, { verdict: "MODIFY", note: " " }, { note: "x".repeat(2001) }, { meetingLabel: "x".repeat(121) }, { sourceRole: "KING" }, { recordedByRole: "ADMIN" }, { submissionKey: "bad" }])
        expect(FeedbackSchema.safeParse({ ...base, ...v }).success).toBe(false);
    expect(FeedbackSchema.safeParse({ ...base, verdict: "MODIFY", note: "change" }).success).toBe(true);
});
it.each(["=1", "+1", "-1", "@x", " \t=1", "\r\n+1", "\u0000=1", "\u0085=1", "\u200b=1"])("neutralizes %s", v => expect(csvCell(v)).toBe('"' + "'" + v + '"'));
it("RFC escaping and header-only export", () => { expect(csvCell('a,"b"\r\né')).toBe('"a,""b""\r\né"'); expect(findingsCsv([])).toBe(CSV_HEADER + "\r\n"); });
it("all chronological events and deterministic latest flag", () => { const r = { assumptionKey: "A1", verdict: "CONFIRM", note: null, meetingLabel: null, sourceRole: null, recordedByRole: null, at: new Date("2026-11-09") }; const s = findingsCsv([{ ...r, id: "b" }, { ...r, id: "a" }]); expect(s.indexOf('"a"')).toBeLessThan(s.indexOf('"b"')); expect(s).toContain('"false"\r\n'); expect(s).toContain('"true"\r\n'); });
