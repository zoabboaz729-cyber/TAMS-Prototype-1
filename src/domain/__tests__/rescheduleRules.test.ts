import { describe,it,expect } from "vitest";
import { termFor } from "../termCalendar";
import { proposalProblem,RescheduleSubmitSchema } from "../rescheduleRules";
const term = termFor(1)!;
const e = { id: "e", versionId: "v", teachingId: "t", venueId: "r", day: "MON", start: "09:00", end: "10:00", locked: false };
const x = { versionId: "v", entryId: "e", originalDate: "2026-11-16", replacementDate: "2026-11-17", replacementStart: "11:00", replacementEnd: "12:00" };
describe("M6 request rules",()=>{
  it("blocks past, locked, no-op and exception weekly changes", () => { const p = { kind:"WEEKLY" as const,sourceEntryId:e.id,proposedDay:"MON" as const,proposedStart:e.start,proposedEnd:e.end,reason:"A valid change reason" }; expect(proposalProblem(p,e,[],term,new Date())).toBe("NO_CHANGE"); expect(proposalProblem(p,{ ...e,locked:true },[],term,new Date())).toBe("LOCKED"); expect(proposalProblem(p,e,[x],term,new Date())).toBe("EXCEPTIONS_REQUIRE_REVIEW"); const one = { ...p,kind:"ONE_OFF" as const,originalDate:x.originalDate,replacementDate:x.replacementDate }; expect(proposalProblem(one,e,[],term,new Date("2026-11-18"))).toBe("PAST_OCCURRENCE"); });
  it("strict submit denies actor and venue forgery", () => { expect(RescheduleSubmitSchema.safeParse({ kind:"WEEKLY",sourceEntryId:"e",proposedDay:"TUE",proposedStart:"11:00",proposedEnd:"12:00",reason:"A valid change reason",actorId:"attacker" }).success).toBe(false); });
});
