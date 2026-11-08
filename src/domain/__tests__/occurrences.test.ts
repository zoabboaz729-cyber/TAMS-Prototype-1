import { describe,it,expect } from "vitest";
import { termFor } from "../termCalendar";
import { materializeDate,assessCandidate } from "../occurrences";
const term = termFor(1)!;
const e = { id: "e", versionId: "v", teachingId: "t", venueId: "r", day: "MON", start: "09:00", end: "10:00", locked: false };
const x = { versionId: "v", entryId: "e", originalDate: "2026-11-16", replacementDate: "2026-11-17", replacementStart: "11:00", replacementEnd: "12:00" };
const context = { teachings: { t: { lecturerId: "l", groupId: "g", expectedSize: 20, venueTypeRequired: "ROOM", unitCode: "X" } }, venues: { r: { capacity: 30, type: "ROOM", code: "R" } }, lecturerUnavailable: {}, venueUnavailable: {} };
describe("M6 occurrences",()=>{
  it("suppresses just the original and preserves other weeks", () => { expect(materializeDate([e],[x],x.originalDate,term)).toHaveLength(0); expect(materializeDate([e],[x],"2026-11-23",term)).toHaveLength(1); const moved = materializeDate([e],[x],x.replacementDate,term)[0]; expect(moved.start).toBe("11:00"); expect(moved.originalDate).toBe(x.originalDate); expect(moved.actualDate).toBe(x.replacementDate); });
  it("same-day move produces one occurrence", () => { const moved = materializeDate([e],[{ ...x,replacementDate:x.originalDate }],x.originalDate,term); expect(moved).toHaveLength(1); expect(moved[0].start).toBe("11:00"); });
  it("stable occurrence identity and no mutation", () => { const before = JSON.stringify([e,x]); const a = materializeDate([e],[],x.originalDate,term)[0]; const b = materializeDate([e],[x],x.replacementDate,term)[0]; expect(a.occurrenceKey).toBe(b.occurrenceKey); expect(JSON.stringify([e,x])).toBe(before); });
  it.each([{ ...x,versionId:"other" },{ ...x,entryId:"missing" },{ ...x,originalDate:"2026-11-17" },{ ...x,replacementDate:"2027-01-01" },{ ...x,replacementStart:"25:00" }])("fails closed on corrupt overlay", bad => expect(() => materializeDate([e],[bad],x.originalDate,term)).toThrow());
  it("duplicate overlay and missing term fail closed", () => { expect(() => materializeDate([e],[x,x],x.originalDate,term)).toThrow(); expect(() => materializeDate([e],[x],x.originalDate,null)).toThrow(); });
  it("detects target-date clashes using M3", () => { const other = { ...e,id:"e2",day:"TUE", start:"11:00",end:"12:00" }; const result = assessCandidate([e,other],[x],context,term); expect(result.status).toBe("CONFLICTED"); expect(result.violations.some(v => v.date === x.replacementDate && v.type === "VENUE_OVERLAP")).toBe(true); });
  it("no phantom clash across dates", () => { const other = { ...x,originalDate:"2026-11-23",replacementDate:"2026-11-24" }; expect(assessCandidate([e],[x,other],context,term).status).toBe("CLEAN"); });
  it("missing context never counts clean", () => expect(assessCandidate([e],[x],{ ...context,teachings:{} },term).status).toBe("INCOMPLETE"));
});
