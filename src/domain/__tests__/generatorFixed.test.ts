/**
 * Focused regression tests for the M4-T1c fixed-entry corrections in
 * `generateTimetable` — a locked row counts toward its teaching's weekly
 * sessions only when its length equals `sessionLength`, and locked rows
 * beyond the requirement are kept and reported instead of passing silently —
 * plus determinism, byte-for-byte preservation, the unchanged seeded
 * behaviour, and M3 validator compatibility.
 */

import { describe, it, expect } from "vitest";
import { generateTimetable, type GeneratorInput, type GeneratorPeriod, type GeneratorTeaching, type GeneratorVenue, type UnplacedFixed } from "../generator";
import { validateEntries, type EntryInput, type ValidationContext } from "../validator";
import { DEFAULT_POLICY } from "../policy";
import { unavailablePeriodsFromRecords } from "../lecturerAvailability";
import { seedLecturerAvailabilities, seedTeachings, seedUnits, seedVenueUnavailabilities, seedVenues } from "../seedData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function teaching(id: string, overrides: Partial<GeneratorTeaching> = {}): GeneratorTeaching {
  return { id, lecturerId: `lecturer-${id}`, groupId: "group-G1", expectedSize: 30, venueTypeRequired: "ROOM", unitCode: `UNIT-${id}`, sessionsPerWeek: 1, sessionLength: 1, ...overrides };
}

function venue(id: string, overrides: Partial<GeneratorVenue> = {}): GeneratorVenue {
  return { id, code: id.replace("venue-", ""), type: "ROOM", capacity: 100, ...overrides };
}

/** A locked row on venue-LH1: [id, teachingId, day, start, end]. */
function fixed(id: string, teachingId: string, day: string, start: string, end: string): EntryInput {
  return { id, teachingId, venueId: "venue-LH1", day, start, end };
}

const durationOf = (entry: EntryInput): number => Number(entry.end.slice(0, 2)) * 60 + Number(entry.end.slice(3, 5)) - Number(entry.start.slice(0, 2)) * 60 - Number(entry.start.slice(3, 5));

function fixedReports(input: GeneratorInput): UnplacedFixed[] {
  return generateTimetable(input, DEFAULT_POLICY).unplaced.filter((item): item is UnplacedFixed => item.kind === "FIXED");
}

/** Validation context for fixtures that carry no unavailability periods. */
function smallContext(input: GeneratorInput): ValidationContext {
  return {
    teachings: Object.fromEntries(input.teachings.map((t) => [t.id, { lecturerId: t.lecturerId, groupId: t.groupId, expectedSize: t.expectedSize, venueTypeRequired: t.venueTypeRequired, unitCode: t.unitCode }])),
    venues: Object.fromEntries(input.venues.map((v) => [v.id, { capacity: v.capacity, type: v.type, code: v.code }])),
    lecturerUnavailable: {},
    venueUnavailable: {},
  };
}

/** The shared M3 meaning of "no clash": nothing flagged, nothing missing. */
function expectNoHardViolations(input: GeneratorInput, entries: readonly EntryInput[]): void {
  const outcome = validateEntries(entries, smallContext(input), DEFAULT_POLICY);
  expect(outcome.status).toBe("ok");
  expect(outcome.violations).toEqual([]);
}

/** Seed-derived input and the full validator context, as the M4-T1 suite builds them. */
function seedInput(): GeneratorInput {
  const unitById = new Map(seedUnits.map((unit) => [unit.id, unit] as const));
  const teachings: GeneratorTeaching[] = seedTeachings.map((item) => {
    const unit = unitById.get(item.unitId)!;
    return { id: item.id, lecturerId: item.lecturerId, groupId: item.groupId, expectedSize: item.expectedSize, venueTypeRequired: unit.venueTypeRequired, unitCode: unit.code, sessionsPerWeek: item.sessionsPerWeek, sessionLength: item.sessionLength };
  });
  const venues: GeneratorVenue[] = seedVenues.map((v) => ({ id: v.id, code: v.code, type: v.type, capacity: v.capacity }));
  const lecturerUnavailable: Record<string, GeneratorPeriod[]> = {};
  for (const record of seedLecturerAvailabilities) {
    if (record.available) continue;
    (lecturerUnavailable[record.lecturerId] ??= []).push({ day: record.day, start: record.start, end: record.end });
  }
  const venueUnavailable: Record<string, GeneratorPeriod[]> = {};
  for (const record of seedVenueUnavailabilities) {
    (venueUnavailable[record.venueId] ??= []).push({ day: record.day, start: record.start, end: record.end });
  }
  return { teachings, venues, lecturerUnavailable, venueUnavailable };
}

function seedContext(input: GeneratorInput): ValidationContext {
  return {
    ...smallContext(input),
    lecturerUnavailable: Object.fromEntries(Object.entries(input.lecturerUnavailable ?? {}).map(([lecturerId, periods]) => [lecturerId, unavailablePeriodsFromRecords((periods as readonly GeneratorPeriod[]).map((p, i) => ({ id: `${lecturerId}-${i}`, day: p.day, start: p.start, end: p.end, available: false })))])),
    venueUnavailable: Object.fromEntries(Object.entries(input.venueUnavailable ?? {}).map(([venueId, periods]) => [venueId, [...(periods as readonly GeneratorPeriod[])]])),
  };
}

// ---------------------------------------------------------------------------
// Correction 1 — duration accounting
// ---------------------------------------------------------------------------

describe("fixed entries count toward weekly sessions only at the right length", () => {
  // Normal case: a correctly sized locked row covers one required session.
  it("counts a correctly sized fixed entry and generates only the remainder", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-two", { sessionsPerWeek: 2, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("f-ok", "t-two", "MON", "08:00", "10:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.unplaced).toEqual([]);
    expect(result.entries).toHaveLength(2);
    const generated = result.entries.filter((entry) => entry.id === "gen-t-two-1");
    expect(generated).toHaveLength(1);
    expect(durationOf(generated[0]!)).toBe(120);
    expectNoHardViolations(input, result.entries);
  });

  // Deliberately conflicting: a one-hour locked row against two-hour sessions.
  it("does not let a shorter fixed entry silently satisfy a longer session", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-two", { sessionsPerWeek: 2, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("f-short", "t-two", "WED", "09:00", "10:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(3); // locked row kept + both 2h sessions generated
    expect(result.entries.filter((entry) => entry.id.startsWith("gen-")).map(durationOf)).toEqual([120, 120]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]).toMatchObject({ kind: "FIXED", entryId: "f-short", teachingId: "t-two", reason: "FIXED_CONFLICT" });
    expect(result.unplaced[0]!.message).toContain("did not count toward the weekly sessions");
    expectNoHardViolations(input, result.entries);
  });

  // Boundary: a longer locked row against shorter required sessions.
  it("does not let a longer fixed entry silently satisfy a shorter session", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-one", { sessionsPerWeek: 2, sessionLength: 1 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("f-long", "t-one", "THU", "08:00", "10:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.filter((entry) => entry.id.startsWith("gen-")).map(durationOf)).toEqual([60, 60]);
    const report = fixedReports(input);
    expect(report).toHaveLength(1);
    expect(report[0]!.entryId).toBe("f-long");
    expect(report[0]!.reason).toBe("FIXED_CONFLICT");
    expectNoHardViolations(input, result.entries);
  });
});

// ---------------------------------------------------------------------------
// Correction 2 — excess fixed sessions
// ---------------------------------------------------------------------------

describe("excess fixed sessions are kept and reported", () => {
  it("keeps both locked rows, generates nothing more, and reports the excess once", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-one")],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("entry-a", "t-one", "MON", "08:00", "09:00"), fixed("entry-b", "t-one", "TUE", "08:00", "09:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(2);
    const report = fixedReports(input);
    expect(report).toHaveLength(1); // one report, not one per row or per pair
    expect(report[0]!.entryId).toBe("entry-b"); // entry-a is the counted one by id order, not input order
    expect(report[0]!.reason).toBe("FIXED_CONFLICT");
    expect(report[0]!.message).toContain("extra session");
    expect(result.unplaced.filter((item) => item.kind === "ACTIVITY")).toEqual([]);
    expectNoHardViolations(input, result.entries);
  });

  it("never silently trims extra rows and never re-drops a required session", () => {
    // 3 valid locked rows against a 2-session teaching: 2 counted, 1 reported.
    const input: GeneratorInput = {
      teachings: [teaching("t-two", { sessionsPerWeek: 2 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("e1", "t-two", "MON", "08:00", "09:00"), fixed("e2", "t-two", "TUE", "08:00", "09:00"), fixed("e3", "t-two", "WED", "08:00", "09:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.map((entry) => entry.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.unplaced.map((item) => [item.kind, item.reason])).toEqual([["FIXED", "FIXED_CONFLICT"]]);
    expectNoHardViolations(input, result.entries);
  });
});

// ---------------------------------------------------------------------------
// Preservation and clashes
// ---------------------------------------------------------------------------

describe("locked rows are preserved byte-for-byte", () => {
  it("returns the exact input shape of a kept row, counted or not", () => {
    const kept = fixed("f-ok", "t-mix", "MON", "08:00", "10:00");
    const wrong = fixed("f-bad", "t-mix", "TUE", "09:00", "10:00");
    const input: GeneratorInput = {
      teachings: [teaching("t-mix", { sessionsPerWeek: 2, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [kept, wrong],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.filter((entry) => entry.id === "f-ok")).toEqual([kept]);
    expect(result.entries.filter((entry) => entry.id === "f-bad")).toEqual([wrong]);
  });

  // Deliberately conflicting: two locked rows that overlap each other.
  it("keeps two clashing locked rows and reports the clash through the validator", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { lecturerId: "lecturer-1", groupId: "group-1" }), teaching("t-b", { lecturerId: "lecturer-2", groupId: "group-2" })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("x-a", "t-a", "MON", "08:00", "09:00"), fixed("x-b", "t-b", "MON", "08:30", "09:30")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual(["x-a", "x-b"]);
    const clash = fixedReports(input).filter((item) => item.message.includes("cannot move"));
    expect(clash).toHaveLength(1);
    expect(clash[0]!.message).toContain("used by two classes");
  });
});

// ---------------------------------------------------------------------------
// Determinism and accounting
// ---------------------------------------------------------------------------

describe("fixed-entry accounting is deterministic", () => {
  it("reordering teachings, venues and locked rows changes nothing", () => {
    const teachings = [
      teaching("tx", { lecturerId: "lx", groupId: "GX", expectedSize: 40, sessionsPerWeek: 2, sessionLength: 2 }),
      teaching("ty", { lecturerId: "ly", groupId: "GY", expectedSize: 30 }),
    ];
    const venues = [venue("venue-LH1", { capacity: 150 }), venue("venue-CR1", { capacity: 60 })];
    const fixedEntries = [
      fixed("f-x-1", "tx", "MON", "08:00", "10:00"),
      fixed("f-x-2", "tx", "TUE", "08:00", "10:00"),
      fixed("f-x-3", "tx", "WED", "08:00", "10:00"), // extra: the 2h rows already cover the 2 required
      fixed("f-x-short", "tx", "THU", "09:00", "10:00"), // wrong length: reported, not counted
      fixed("f-y-1", "ty", "FRI", "08:00", "09:00"),
    ];
    const forward: GeneratorInput = { teachings, venues, fixedEntries };
    const reversed: GeneratorInput = { teachings: [...teachings].reverse(), venues: [...venues].reverse(), fixedEntries: [...fixedEntries].reverse() };
    const first = generateTimetable(forward, DEFAULT_POLICY);
    expect(generateTimetable(reversed, DEFAULT_POLICY)).toEqual(first);
    // The same rows are reported whichever order the draft arrived in.
    const reportIds = fixedReports(forward).map((item) => item.entryId);
    expect(reportIds).toEqual(["f-x-3", "f-x-short"]);
    expect(new Set(reportIds).size).toBe(reportIds.length); // no duplicate warnings
    expectNoHardViolations(forward, first.entries);
  });

  it("generated + counted fixed + unplaced activities account for every required session", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-three", { sessionsPerWeek: 3, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [fixed("acc-ok", "t-three", "MON", "08:00", "10:00"), fixed("acc-bad", "t-three", "TUE", "09:00", "10:00")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    const generated = result.entries.filter((entry) => entry.id.startsWith("gen-")).length;
    const countedFixed = 1; // acc-ok only; acc-bad is reported, not counted
    const unplacedActivities = result.unplaced.filter((item) => item.kind === "ACTIVITY").length;
    expect(generated + countedFixed + unplacedActivities).toBe(3);
    expect(result.entries).toHaveLength(generated + 2); // two locked rows kept
    expectNoHardViolations(input, result.entries);
  });
});

// ---------------------------------------------------------------------------
// Seeded behaviour and M3 compatibility
// ---------------------------------------------------------------------------

describe("ordinary seeded generation is unchanged by M4-T1c", () => {
  const input = seedInput();
  const result = generateTimetable(input, DEFAULT_POLICY);

  // Measured at f61de40 before this task: 81 placed, 9 unplaced, softScore 62.
  it("produces the same placement counts and penalty as the accepted M4-T1 run", () => {
    expect(result.entries.length).toBe(81);
    expect(result.unplaced.length).toBe(9);
    expect(result.softScore).toBe(62);
    expect(result.unplaced.every((item) => item.kind === "ACTIVITY" && item.reason === "NO_COMPATIBLE_VENUE")).toBe(true);
  });

  it("leaves the generated board free of M3 hard violations", () => {
    const outcome = validateEntries(result.entries, seedContext(input), DEFAULT_POLICY);
    expect(outcome.status).toBe("ok");
    expect(outcome.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Search limitation (documented, not proven infeasibility)
// ---------------------------------------------------------------------------

describe("step-limited search reports a budget cut, not infeasibility", () => {
  const input: GeneratorInput = {
    teachings: [teaching("t-a", { sessionsPerWeek: 3 }), teaching("t-b", { groupId: "group-G2", sessionsPerWeek: 3 })],
    venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
  };

  it("keeps placements made before the cut and names the rest as STEP_LIMIT", () => {
    const starved = generateTimetable({ ...input, stepLimit: 5 }, DEFAULT_POLICY);
    expect(starved.entries.length).toBeLessThan(6);
    const stopped = starved.unplaced.filter((item) => item.reason === "STEP_LIMIT");
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped[0]!.message).toContain("search stopped at its limit");
    expect(starved.entries.length + starved.unplaced.length).toBe(6);
    // Chunk pinning can sacrifice later placements even though a bigger budget
    // fits all six — the report says the budget ran out, not that the week is
    // impossible, and the default run below is the evidence.
    expect(generateTimetable(input, DEFAULT_POLICY).entries).toHaveLength(6);
    expectNoHardViolations(input, starved.entries);
  });
});
