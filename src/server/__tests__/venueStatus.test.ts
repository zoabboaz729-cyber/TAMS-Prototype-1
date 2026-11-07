import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/permissions";
import { USER_ROLES } from "@/domain/types";
import { campusVenueClock, readVenueStatus } from "../venueStatus";
import type { VenueStatusStore } from "../venueStatusContract";
const actor = (role: Actor["role"] = "OFFICER"): Actor => ({ id: "actor", role, departmentId: null, studentGroupId: null });
const now = () => new Date("2026-11-09T05:30:00Z"); // Monday 08:30 EAT
const q = { mode: "demo", day: "MON", time: "08:30" };
const venue = (over = {}) => ({ id: "v", code: "CR1", type: "ROOM", status: "ACTIVE", unavailabilities: [], ...over });
const entry = (over = {}) => ({ versionId: "pub", venueId: "v", day: "MON", start: "08:00", end: "09:00", unitSemester: 1, ...over });
const fixture = () => ({
  versions: [{ id: "pub", semester: 1, status: "PUBLISHED", publishedAt: new Date("2026-11-08T00:00:00Z") }],
  venues: [venue()], entries: [entry()],
});
function store(data: unknown = fixture()) { return { readSnapshot: vi.fn(async () => data) }; }
const read = (data: unknown = fixture(), input: unknown = q, a: Actor | null = actor()) => readVenueStatus(a, input, store(data), now);
describe("M5-T2a trusted status reads", () => {
  it("unauthenticated rejects before any read", async () => {
    const s = store(); expect(await readVenueStatus(null, {}, s, now)).toMatchObject({ kind: "UNAUTHENTICATED" }); expect(s.readSnapshot).not.toHaveBeenCalled();
  });
  it("unsupported runtime role rejects before any read", async () => {
    const s = store(); const a = { ...actor(), role: "UNKNOWN" } as unknown as Actor;
    expect(await readVenueStatus(a, {}, s, now)).toMatchObject({ kind: "FORBIDDEN" }); expect(s.readSnapshot).not.toHaveBeenCalled();
  });
  it.each([
    null, [], { semester: "3" }, { semester: 1 }, { semester: ["1", "2"] }, { role: "ADMIN" },
    { actor: { role: "ADMIN" } }, { versionId: "pub" }, { mode: "LIVE" }, { mode: "demo" },
    { mode: "live", day: "MON", time: "08:30" }, { ...q, time: ["08:30"] }, { ...q, extra: "x" },
  ])("rejects strict invalid request %j without reads", async (input) => {
    const s = store(); expect(await readVenueStatus(actor(), input, s, now)).toMatchObject({ kind: "INVALID_INPUT" }); expect(s.readSnapshot).not.toHaveBeenCalled();
  });
  it.each([{ ...q, day: "BAD" }, { ...q, time: "8:30" }, { ...q, time: "24:00" }])("rejects invalid demo clock %j without reads", async (input) => {
    const s = store(); expect(await readVenueStatus(actor(), input, s, now)).toMatchObject({ kind: "INVALID_CLOCK" }); expect(s.readSnapshot).not.toHaveBeenCalled();
  });
  it.each(USER_ROLES)("%s gets sanitized live status", async (role) => {
    const data = fixture(); Object.assign(data.entries[0], { teachingId: "private-teaching", lecturerName: "PRIVATE", studentGroupId: "private-group" });
    const result = await read(data, {}, actor(role));
    expect(result).toMatchObject({ ok: true, mode: "live", asOf: { day: "MON", time: "08:30" }, rows: [{ code: "CR1", status: "OCCUPIED" }] });
    const serialized = JSON.stringify(result);
    for (const text of ["PRIVATE", "private-", "venueId", "versionId", "unitSemester", "teachingId", "unavailabilities", "actor", "email"]) expect(serialized).not.toContain(text);
    if (role !== "OFFICER" && role !== "ADMIN") expect(result).not.toHaveProperty("integrityCount");
  });
  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER"] as const)("%s forged demo denied before reads", async (role) => {
    const s = store(); expect(await readVenueStatus(actor(role), q, s, now)).toMatchObject({ kind: "FORBIDDEN" }); expect(s.readSnapshot).not.toHaveBeenCalled();
  });
  it.each(["OFFICER", "ADMIN"] as const)("%s may use simulated weekday/time", async (role) => {
    expect(await read(fixture(), { ...q, day: "SAT", time: "23:59" }, actor(role))).toMatchObject({ ok: true, mode: "demo", outsideHours: true, asOf: { day: "SAT", time: "23:59" } });
  });
  it("no publication is a failure, not free", async () => expect(await read({ ...fixture(), versions: [] })).toMatchObject({ kind: "NO_PUBLISHED_VERSION" }));
  it("ambiguous publication is never arbitrary", async () => {
    const d = fixture(); d.versions.push({ ...d.versions[0], id: "other" }); expect(await read(d)).toMatchObject({ kind: "AMBIGUOUS_PUBLISHED_VERSION" });
  });
  it.each([
    { status: "DRAFT" }, { status: "ARCHIVED" }, { semester: 2 }, { publishedAt: null }, { id: "" }, { publishedAt: new Date("bad") },
  ])("corrupt current version fails %j", async (over) => {
    const d = fixture(); expect(await read({ ...d, versions: [{ ...d.versions[0], ...over }] })).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
  });
  it.each([
    { entries: [entry({ versionId: "draft" })] }, { entries: [entry({ venueId: "missing" })] },
    { entries: [entry({ unitSemester: 2 })] }, { entries: [entry({ unitSemester: null })] },
    { entries: [entry({ start: "bad" })] }, { entries: [entry({ day: "SUN" })] },
    { venues: [venue({ status: "UNKNOWN" })] }, { venues: [venue({ unavailabilities: [{ venueId: "wrong", day: "MON", start: "08:00", end: "09:00" }] })] },
    { venues: [venue(), venue()] }, { venues: [], entries: [entry()] },
  ])("corrupt relevant rows fail closed %j", async (over) => expect(await read({ ...fixture(), ...over })).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" }));
  it("valid empty publication differs from empty venue register", async () => {
    expect(await read({ ...fixture(), entries: [] })).toMatchObject({ ok: true, rows: [{ status: "FREE" }] });
    expect(await read({ ...fixture(), entries: [], venues: [] })).toMatchObject({ ok: true, rows: [] });
  });
  it("sorts codes stably and only privileged actors receive integrity count", async () => {
    const d = { ...fixture(), entries: [entry(), entry()], venues: [venue({ id: "z", code: "Z" }), venue()] };
    const result = await read(d); expect(result).toMatchObject({ ok: true, integrityCount: 1, rows: [{ code: "CR1" }, { code: "Z" }] });
    expect(await read(d, {}, actor("STUDENT"))).not.toHaveProperty("integrityCount");
  });
  it("selects semester from strict validated input and next read reflects replacement", async () => {
    const s = store(); await readVenueStatus(actor(), { semester: "2" }, s, now); expect(s.readSnapshot).toHaveBeenCalledWith(2);
    const d = fixture(); s.readSnapshot.mockResolvedValue(d);
    const first = await readVenueStatus(actor(), {}, s, now);
    d.versions[0].id = "new"; d.entries = [];
    const second = await readVenueStatus(actor(), {}, s, now);
    expect(first).toMatchObject({ publication: { id: "pub" } }); expect(second).toMatchObject({ publication: { id: "new" }, rows: [{ status: "FREE" }] });
  });
  it("demo does not read wall clock or mutate store data", async () => {
    const d = fixture(), before = JSON.stringify(d), clock = vi.fn(() => { throw new Error("not called"); });
    await readVenueStatus(actor(), q, store(d), clock);
    expect(clock).not.toHaveBeenCalled(); expect(JSON.stringify(d)).toBe(before);
  });
  it("unexpected errors are fixed and neither logged nor leaked", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s: VenueStatusStore = { readSnapshot: async () => { throw new Error("SQL secret /db/private.db password=private"); } };
    expect(await readVenueStatus(actor(), {}, s, now)).toEqual({ ok: false, kind: "INTERNAL_ERROR", message: "Venue status could not be loaded. Try again or contact an officer." });
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it.each([
    ["2026-11-08T20:59:00Z", "SUN", "23:59"], ["2026-11-08T21:00:00Z", "MON", "00:00"],
    ["2026-11-09T21:30:00Z", "TUE", "00:30"],
  ])("campus conversion %s", (instant, day, time) => expect(campusVenueClock(new Date(instant))).toEqual({ day, time }));
});
