import { describe, expect, it } from "vitest";
import { DEFAULT_VENUE_STATUS_POLICY as policy, venueStatus, type StatusVenue, type VenueStatusVersion } from "../venueStatus";
const venue: StatusVenue = { id: "v", code: "CR1", type: "ROOM", status: "ACTIVE", unavailabilities: [] };
const entry = (start = "08:00", end = "09:00", over = {}) => ({ versionId: "pub", venueId: "v", day: "MON" as const, start, end, ...over });
const version: VenueStatusVersion = { id: "pub", semester: 1, status: "PUBLISHED", entries: [entry()] };
function run(time = "08:00", entries = version.entries, v = venue, day = "MON", p = policy) {
  return venueStatus({ ...version, entries }, v, { day, time }, p);
}
function ok(result: ReturnType<typeof run>) { if (!result.ok) throw new Error(JSON.stringify(result)); return result; }
describe("M5-T1 pure venue status", () => {
  it.each([
    ["07:29", "FREE"], ["07:30", "UPCOMING"], ["07:59", "UPCOMING"], ["08:00", "OCCUPIED"],
    ["08:59", "OCCUPIED"], ["09:00", "FREE"], ["23:59", "FREE"],
  ])("boundary %s -> %s", (time, status) => expect(ok(run(time)).status).toBe(status));
  it("adjacent sessions merge at boundary without a false free gap", () => {
    const r = ok(run("09:00", [entry(), entry("09:00", "10:00")]));
    expect(r.status).toBe("OCCUPIED"); expect(r.nextFreeAt).toEqual({ day: "MON", time: "10:00" });
  });
  it("overlap/closure union is deterministic and signals integrity", () => {
    const entries = [entry(), entry("08:30", "10:00"), entry("10:30", "11:00")];
    const v = { ...venue, unavailabilities: [{ venueId: "v", day: "MON" as const, start: "09:30", end: "10:30" }] };
    const r = ok(run("08:45", entries, v));
    expect(r.nextFreeAt?.time).toBe("11:00"); expect(r.integrityCount).toBe(2);
    expect(run("08:45", [...entries].reverse(), v)).toEqual(r);
  });
  it("active empty publication is free, a different venue never occupies this one", () => {
    expect(ok(run("08:00", [])).status).toBe("FREE");
    expect(ok(run("08:00", [entry("08:00", "09:00", { venueId: "other" })])).status).toBe("FREE");
  });
  it.each(["INACTIVE", "MAINTENANCE"] as const)("%s is indefinite UNAVAILABLE", (status) => {
    const r = ok(run("08:00", [], { ...venue, status }));
    expect(r.status).toBe("UNAVAILABLE"); expect(r.nextFreeAt).toBeNull(); expect(r.unavailableKind).toBe("operational");
  });
  it.each([["07:59", "FREE"], ["08:00", "UNAVAILABLE"], ["08:59", "UNAVAILABLE"], ["09:00", "FREE"]])("closure boundary %s", (time, status) => {
    expect(ok(run(time, [], { ...venue, unavailabilities: [{ venueId: "v", day: "MON", start: "08:00", end: "09:00" }] })).status).toBe(status);
  });
  it("closure takes precedence and adjoining class blocks next free", () => {
    const v = { ...venue, unavailabilities: [{ venueId: "v", day: "MON" as const, start: "07:00", end: "08:30" }] };
    const r = ok(run("08:00", [entry()], v));
    expect(r.status).toBe("UNAVAILABLE"); expect(r.integrityCount).toBe(1); expect(r.nextFreeAt?.time).toBe("09:00");
    expect(ok(run("08:30", [entry()], v)).status).toBe("OCCUPIED");
  });
  it("earlier closure suppresses upcoming without pretending it is already closed", () => {
    const v = { ...venue, unavailabilities: [{ venueId: "v", day: "MON" as const, start: "07:40", end: "07:50" }] };
    expect(ok(run("07:30", [entry()], v)).status).toBe("FREE");
  });
  it("upcoming is currently free with generic next scheduled clock", () => {
    const r = ok(run("07:30")); expect(r.nextFreeAt).toEqual(r.asOf); expect(r.nextScheduledAt).toEqual({ day: "MON", time: "08:00" });
  });
  it("other days and weekends have no weekly booking; outside hours is explicit", () => {
    expect(ok(run("08:00", version.entries, venue, "TUE")).status).toBe("FREE");
    for (const day of ["SAT", "SUN"]) expect(ok(run("08:00", version.entries, venue, day)).outsideHours).toBe(true);
    expect(ok(run("07:59")).outsideHours).toBe(true);
    expect(ok(run("17:00")).outsideHours).toBe(true);
    expect(ok(run("16:00", [entry("16:00", "17:00")])).nextFreeOutsideHours).toBe(true);
  });
  it.each(["8:00", "24:00", "08:60", " 08:00", "08:00:00", "", null])("rejects bad clock %s", (time) => {
    expect(venueStatus(version, venue, { day: "MON", time })).toMatchObject({ ok: false, kind: "INVALID_CLOCK" });
  });
  it("rejects bad days and forged clock keys", () => {
    for (const clock of [{ day: "BAD", time: "08:00" }, { day: "MON", time: "08:00", role: "ADMIN" }])
      expect(venueStatus(version, venue, clock)).toMatchObject({ ok: false, kind: "INVALID_CLOCK" });
  });
  it.each([
    { upcomingMinutes: -1 }, { upcomingMinutes: 1.2 }, { upcomingMinutes: NaN }, { days: [] },
    { days: ["MON", "MON"] }, { days: ["SAT"] }, { slotStart: "17:00" }, { slotEnd: "bad" },
  ])("invalid policy fails closed %j", (over) => expect(venueStatus(version, venue, { day: "MON", time: "08:00" }, { ...policy, ...over })).toMatchObject({ ok: false, kind: "INVALID_POLICY" }));
  it("upcoming policy is configurable", () => {
    expect(ok(run("07:30", version.entries, venue, "MON", { ...policy, upcomingMinutes: 29 })).status).toBe("FREE");
    expect(ok(run("07:29", version.entries, venue, "MON", { ...policy, upcomingMinutes: 31 })).status).toBe("UPCOMING");
  });
  it.each([
    { id: "" }, { status: "UNKNOWN" }, { unavailabilities: [{ venueId: "v", day: "MON", start: "09:00", end: "08:00" }] },
    { unavailabilities: [{ venueId: "v", day: "SAT", start: "08:00", end: "09:00" }] },
  ])("invalid venue %j", (over) => expect(venueStatus(version, { ...venue, ...over }, { day: "MON", time: "08:00" })).toMatchObject({ ok: false, kind: "INVALID_VENUE" }));
  it.each([
    { versionId: "wrong" }, { venueId: "" }, { day: "SAT" }, { start: "09:00", end: "08:00" },
    { start: "08:00", end: "08:00" }, { start: "23:00", end: "01:00" }, { start: "bad" },
  ])("invalid published entry %j", (over) => expect(run("08:00", [entry("08:00", "09:00", over)])).toMatchObject({ ok: false, kind: "INVALID_PUBLISHED_DATA" }));
  it.each([{ id: "" }, { status: "DRAFT" }, { semester: 3 }, { entries: null }])("rejects invalid version %j", (over) => {
    expect(venueStatus({ ...version, ...over }, venue, { day: "MON", time: "08:00" })).toMatchObject({ ok: false, kind: "INVALID_PUBLISHED_DATA" });
  });
  it("wrong closure link fails even for an operationally unavailable venue", () => {
    expect(run("08:00", [], { ...venue, status: "MAINTENANCE", unavailabilities: [{ venueId: "wrong", day: "MON", start: "08:00", end: "09:00" }] })).toMatchObject({ ok: false, kind: "INVALID_PUBLISHED_DATA" });
  });
  it("does not mutate inputs and fixed inputs are byte-identical", () => {
    const before = JSON.stringify({ version, venue, policy });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(JSON.stringify({ version, venue, policy })).toBe(before);
  });
});
