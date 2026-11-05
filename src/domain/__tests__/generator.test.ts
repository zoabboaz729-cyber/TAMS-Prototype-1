/**
 * Unit tests for the M4-T1 generator (`generateTimetable`).
 *
 * Every test is a pure call: the same input and policy must always give the
 * same output, so no database, network or clock is involved. The hard
 * constraints are asserted through the accepted M3 validator
 * (`validateEntries`) rather than through a second, generator-specific
 * definition of a clash, and each test also names the case it covers:
 * normal, boundary or deliberately conflicting.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_STEP_LIMIT,
  generateTimetable,
  type GeneratorInput,
  type GeneratorPeriod,
  type GeneratorTeaching,
  type GeneratorVenue,
  type UnplacedActivity,
  type UnplacedFixed,
} from "../generator";
import {
  validateEntries,
  type EntryInput,
  type ValidationContext,
} from "../validator";
import { DEFAULT_POLICY, type PolicyConfig } from "../policy";
import { unavailablePeriodsFromRecords } from "../lecturerAvailability";
import {
  seedLecturerAvailabilities,
  seedTeachings,
  seedUnits,
  seedVenueUnavailabilities,
  seedVenues,
} from "../seedData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MON only, 08:00-09:00 — exactly one placeable hour for a 1-hour session. */
const ONE_SLOT: PolicyConfig = { ...DEFAULT_POLICY, days: ["MON"], slotStart: "08:00", slotEnd: "09:00" };
/** MON only, 08:00-10:00 — two hours, no lunch in the window. */
const MON_TWO_HOURS: PolicyConfig = { ...DEFAULT_POLICY, days: ["MON"], slotStart: "08:00", slotEnd: "10:00" };
/** MON only, the full teaching day — one group can be pushed past its day limit. */
const MON_FULL_DAY: PolicyConfig = { ...DEFAULT_POLICY, days: ["MON"] };

function teaching(
  id: string,
  overrides: Partial<GeneratorTeaching> = {},
): GeneratorTeaching {
  return {
    id,
    lecturerId: `lecturer-${id}`,
    groupId: "group-G1",
    expectedSize: 30,
    venueTypeRequired: "ROOM",
    unitCode: `UNIT-${id}`,
    sessionsPerWeek: 1,
    sessionLength: 1,
    ...overrides,
  };
}

function venue(id: string, overrides: Partial<GeneratorVenue> = {}): GeneratorVenue {
  return { id, code: id.replace("venue-", ""), type: "ROOM", capacity: 100, ...overrides };
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationOf(entry: EntryInput): number {
  return minutesOf(entry.end) - minutesOf(entry.start);
}

function onlyFixed(unplaced: readonly (UnplacedActivity | UnplacedFixed)[]): UnplacedFixed[] {
  return unplaced.filter((item): item is UnplacedFixed => item.kind === "FIXED");
}

/** Build the ValidationContext the accepted M3 validator needs from generator input. */
function contextFor(input: GeneratorInput): ValidationContext {
  return {
    teachings: Object.fromEntries(
      input.teachings.map((item) => [
        item.id,
        {
          lecturerId: item.lecturerId,
          groupId: item.groupId,
          expectedSize: item.expectedSize,
          venueTypeRequired: item.venueTypeRequired,
          unitCode: item.unitCode,
        },
      ]),
    ),
    venues: Object.fromEntries(
      input.venues.map((item) => [
        item.id,
        { capacity: item.capacity, type: item.type, code: item.code },
      ]),
    ),
    lecturerUnavailable: Object.fromEntries(
      Object.entries(input.lecturerUnavailable ?? {}).map(([lecturerId, periods]) => [
        lecturerId,
        unavailablePeriodsFromRecords(
          (periods as readonly GeneratorPeriod[]).map((period, index) => ({
            id: `${lecturerId}-${index}`,
            day: period.day,
            start: period.start,
            end: period.end,
            available: false,
          })),
        ),
      ]),
    ),
    venueUnavailable: Object.fromEntries(
      Object.entries(input.venueUnavailable ?? {}).map(([venueId, periods]) => [
        venueId,
        [...(periods as readonly GeneratorPeriod[])],
      ]),
    ),
  };
}

/**
 * The shared meaning of "no clash": the M3-T1 validator finds nothing and had
 * every piece of context it needed.
 */
function expectNoHardViolations(input: GeneratorInput, entries: readonly EntryInput[]): void {
  const outcome = validateEntries(entries, contextFor(input), DEFAULT_POLICY);
  expect(outcome.status).toBe("ok");
  expect(outcome.violations).toEqual([]);
}

function sessionsOwed(input: GeneratorInput): number {
  return input.teachings.reduce((sum, item) => sum + item.sessionsPerWeek, 0);
}

/** Seed-derived generator input — the data the pilot demo runs on. */
function seedInput(): GeneratorInput {
  const unitById = new Map(seedUnits.map((unit) => [unit.id, unit] as const));
  const teachings: GeneratorTeaching[] = seedTeachings.map((item) => {
    const unit = unitById.get(item.unitId)!;
    return {
      id: item.id,
      lecturerId: item.lecturerId,
      groupId: item.groupId,
      expectedSize: item.expectedSize,
      venueTypeRequired: unit.venueTypeRequired,
      unitCode: unit.code,
      sessionsPerWeek: item.sessionsPerWeek,
      sessionLength: item.sessionLength,
    };
  });
  const venues: GeneratorVenue[] = seedVenues.map((item) => ({
    id: item.id,
    code: item.code,
    type: item.type,
    capacity: item.capacity,
  }));

  const lecturerUnavailable: Record<string, GeneratorPeriod[]> = {};
  for (const record of seedLecturerAvailabilities) {
    if (record.available) continue;
    (lecturerUnavailable[record.lecturerId] ??= []).push({
      day: record.day,
      start: record.start,
      end: record.end,
    });
  }
  const venueUnavailable: Record<string, GeneratorPeriod[]> = {};
  for (const record of seedVenueUnavailabilities) {
    (venueUnavailable[record.venueId] ??= []).push({
      day: record.day,
      start: record.start,
      end: record.end,
    });
  }
  return { teachings, venues, lecturerUnavailable, venueUnavailable };
}

// ---------------------------------------------------------------------------
// 1. Seed-derived input
// ---------------------------------------------------------------------------

describe("generateTimetable with the seeded pilot data", () => {
  const input = seedInput();
  const result = generateTimetable(input, DEFAULT_POLICY);

  it("produces a timetable with zero hard violations", () => {
    expect(result.entries.length).toBeGreaterThan(0);
    const outcome = validateEntries(result.entries, contextFor(input), DEFAULT_POLICY);
    expect(outcome.status).toBe("ok");
    expect(outcome.violations).toEqual([]);
  });

  it("accounts for every seeded session exactly once", () => {
    const owed = sessionsOwed(input);
    expect(owed).toBeGreaterThan(0);
    expect(result.entries.length + result.unplaced.length).toBe(owed);
    expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(result.entries.length);
  });

  it("returns the week in day-then-time order and a non-negative penalty score", () => {
    const rank = (entry: EntryInput): number => DEFAULT_POLICY.days.indexOf(entry.day);
    const ordered = [...result.entries].sort(
      (a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
    );
    expect(result.entries).toEqual(ordered);
    expect(Number.isFinite(result.softScore)).toBe(true);
    expect(result.softScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism and the empty case
// ---------------------------------------------------------------------------

describe("generateTimetable determinism", () => {
  it("gives an identical result for identical input and policy", () => {
    const input = seedInput();
    const first = JSON.stringify(generateTimetable(input, DEFAULT_POLICY));
    const second = JSON.stringify(generateTimetable(input, DEFAULT_POLICY));
    expect(second).toBe(first);

    const small: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 3 }), teaching("t-b", { groupId: "group-G2" })],
      venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
    };
    expect(JSON.stringify(generateTimetable(small, DEFAULT_POLICY))).toBe(
      JSON.stringify(generateTimetable(small, DEFAULT_POLICY)),
    );
  });

  it("reorders the input without changing the output", () => {
    const small: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 2, expectedSize: 40 }), teaching("t-b", { groupId: "group-G2" })],
      venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
    };
    const reversed: GeneratorInput = {
      ...small,
      teachings: [...small.teachings].reverse(),
      venues: [...small.venues].reverse(),
    };
    expect(generateTimetable(reversed, DEFAULT_POLICY)).toEqual(generateTimetable(small, DEFAULT_POLICY));
  });

  it("returns a valid empty result for an empty teaching list", () => {
    const empty: GeneratorInput = { teachings: [], venues: [] };
    expect(generateTimetable(empty, DEFAULT_POLICY)).toEqual({
      entries: [],
      unplaced: [],
      softScore: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Required sessions: sessionsPerWeek and sessionLength
// ---------------------------------------------------------------------------

describe("generateTimetable session expansion", () => {
  it("gives each teaching exactly its sessionsPerWeek sessions of sessionLength hours", () => {
    const input: GeneratorInput = {
      teachings: [
        teaching("t-two", { sessionsPerWeek: 3, sessionLength: 2 }),
        teaching("t-one", { sessionsPerWeek: 2, sessionLength: 1, groupId: "group-G2" }),
      ],
      venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.unplaced).toEqual([]);

    const rowsFor = (teachingId: string): EntryInput[] =>
      result.entries.filter((entry) => entry.teachingId === teachingId);
    expect(rowsFor("t-two")).toHaveLength(3);
    expect(rowsFor("t-one")).toHaveLength(2);

    for (const entry of rowsFor("t-two")) {
      expect(durationOf(entry)).toBe(120);
    }
    for (const entry of rowsFor("t-one")) {
      expect(durationOf(entry)).toBe(60);
    }
    expectNoHardViolations(input, result.entries);
  });

  it("never places a session over the lunch break or outside the slot window", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-two", { sessionsPerWeek: 5, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(5);
    for (const entry of result.entries) {
      expect(entry.start >= DEFAULT_POLICY.slotStart).toBe(true);
      expect(entry.end <= DEFAULT_POLICY.slotEnd).toBe(true);
      expect(entry.start < DEFAULT_POLICY.lunchEnd && DEFAULT_POLICY.lunchStart < entry.end).toBe(false);
    }
  });

  it("does not schedule a session twice when a locked draft row already exists", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-two", { sessionsPerWeek: 2 })],
      venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
      fixedEntries: [
        { id: "entry-locked", teachingId: "t-two", venueId: "venue-LH1", day: "WED", start: "09:00", end: "10:00" },
      ],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.unplaced).toEqual([]);
    expect(result.entries.filter((entry) => entry.teachingId === "t-two")).toHaveLength(2);

    const locked = result.entries.find((entry) => entry.id === "entry-locked");
    expect(locked).toEqual({
      id: "entry-locked",
      teachingId: "t-two",
      venueId: "venue-LH1",
      day: "WED",
      start: "09:00",
      end: "10:00",
    });
    expectNoHardViolations(input, result.entries);
  });

  it("keeps extra locked rows without asking for more sessions", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-one", { sessionsPerWeek: 1 })],
      venues: [venue("venue-LH1")],
      fixedEntries: [
        { id: "entry-a", teachingId: "t-one", venueId: "venue-LH1", day: "MON", start: "08:00", end: "09:00" },
        { id: "entry-b", teachingId: "t-one", venueId: "venue-LH1", day: "TUE", start: "08:00", end: "09:00" },
      ],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.map((entry) => entry.id)).toEqual(["entry-a", "entry-b"]);
    expect(result.unplaced).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Hard constraints
// ---------------------------------------------------------------------------

describe("generateTimetable hard constraints", () => {
  it("will not let one lecturer teach two classes in the only free hour", () => {
    const input: GeneratorInput = {
      teachings: [
        teaching("t-a", { lecturerId: "lecturer-shared", groupId: "group-G1" }),
        teaching("t-b", { lecturerId: "lecturer-shared", groupId: "group-G2" }),
      ],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.entries).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
    expectNoHardViolations(input, result.entries);
  });

  it("will not let one group attend two classes in the only free hour", () => {
    const input: GeneratorInput = {
      teachings: [
        teaching("t-a", { lecturerId: "lecturer-1", groupId: "group-shared" }),
        teaching("t-b", { lecturerId: "lecturer-2", groupId: "group-shared" }),
      ],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.entries).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
    expectNoHardViolations(input, result.entries);
  });

  it("will not put two classes in one venue in the only free hour", () => {
    const input: GeneratorInput = {
      teachings: [
        teaching("t-a", { lecturerId: "lecturer-1", groupId: "group-1" }),
        teaching("t-b", { lecturerId: "lecturer-2", groupId: "group-2" }),
      ],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.entries).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
    expectNoHardViolations(input, result.entries);
  });

  it("refuses a venue that is too small and uses the one that fits", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { expectedSize: 55 })],
      venues: [venue("venue-CR1", { capacity: 40 }), venue("venue-LH1", { capacity: 150 })],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.venueId).toBe("venue-LH1");
    expect(result.unplaced).toEqual([]);
  });

  it("refuses a venue of the wrong type even when it is the bigger room", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { expectedSize: 30, venueTypeRequired: "LAB" })],
      venues: [venue("venue-CR1", { capacity: 200 }), venue("venue-LAB1", { type: "LAB", capacity: 40 })],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries[0]!.venueId).toBe("venue-LAB1");
    expectNoHardViolations(input, result.entries);
  });

  it("keeps a session out of its lecturer's unavailable periods", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { lecturerId: "lecturer-A", sessionsPerWeek: 2, sessionLength: 2 })],
      venues: [venue("venue-LH1")],
      lecturerUnavailable: { "lecturer-A": [{ day: "MON", start: "08:00", end: "17:00" }] },
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((entry) => entry.day !== "MON")).toBe(true);
    expectNoHardViolations(input, result.entries);
  });

  it("keeps a session out of its venue's unavailable periods", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 3 })],
      venues: [venue("venue-LH1")],
      venueUnavailable: {
        "venue-LH1": [
          { day: "MON", start: "08:00", end: "12:00" },
          { day: "MON", start: "12:00", end: "14:00" },
          { day: "MON", start: "14:00", end: "17:00" },
        ],
      },
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.every((entry) => entry.day !== "MON")).toBe(true);
    expectNoHardViolations(input, result.entries);
  });

  it("drops nothing when a lecturer is unavailable for the only slot", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { lecturerId: "lecturer-A" })],
      venues: [venue("venue-LH1")],
      lecturerUnavailable: { "lecturer-A": [{ day: "MON", start: "08:30", end: "08:45" }] },
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.entries).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
  });
});

// ---------------------------------------------------------------------------
// 5. Unplaced reporting
// ---------------------------------------------------------------------------

describe("generateTimetable unplaced reporting", () => {
  it("explains a session no venue can hold", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-lab", { venueTypeRequired: "LAB", expectedSize: 45, sessionsPerWeek: 2 })],
      venues: [venue("venue-CR1", { capacity: 60 }), venue("venue-LAB1", { type: "LAB", capacity: 40 })],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toEqual([]);
    expect(result.unplaced).toHaveLength(2);
    for (const item of result.unplaced) {
      expect(item.kind).toBe("ACTIVITY");
      expect(item.reason).toBe("NO_COMPATIBLE_VENUE");
      expect(item.message).toContain("LAB");
      expect(item.message).toContain("45");
      expect(item.teachingId).toBe("t-lab");
    }
  });

  it("explains a session the slot window cannot hold", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-long", { sessionsPerWeek: 1, sessionLength: 3 })],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
  });

  it("keeps a locked row that clashes and reports it instead of moving it", () => {
    const input: GeneratorInput = {
      teachings: [
        teaching("t-a", { lecturerId: "lecturer-1", groupId: "group-1" }),
        teaching("t-b", { lecturerId: "lecturer-2", groupId: "group-2" }),
      ],
      venues: [venue("venue-LH1", { capacity: 200 })],
      fixedEntries: [
        { id: "entry-a", teachingId: "t-a", venueId: "venue-LH1", day: "MON", start: "08:00", end: "09:00" },
        { id: "entry-b", teachingId: "t-b", venueId: "venue-LH1", day: "MON", start: "08:30", end: "09:30" },
      ],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);

    // Both locked rows stay exactly where they were; the clash is reported.
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual(["entry-a", "entry-b"]);
    expect(
      result.entries
        .filter((entry) => entry.id === "entry-b")
        .map((entry) => `${entry.day} ${entry.start}-${entry.end}`),
    ).toEqual(["MON 08:30-09:30"]);

    const clash = onlyFixed(result.unplaced).filter((item) => item.reason === "FIXED_CONFLICT");
    expect(clash).toHaveLength(1);
    expect(clash[0]!.entryId).toBe("entry-a");
    expect(clash[0]!.message).toContain("cannot move");
    expect(clash[0]!.message).toContain("used by two classes");
  });

  it("reports a locked row whose teaching or venue is not in the input", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a")],
      venues: [venue("venue-LH1")],
      fixedEntries: [
        { id: "entry-ghost-teaching", teachingId: "teaching-ghost", venueId: "venue-LH1", day: "MON", start: "08:00", end: "09:00" },
        { id: "entry-ghost-venue", teachingId: "t-a", venueId: "venue-ghost", day: "TUE", start: "08:00", end: "09:00" },
      ],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.map((entry) => entry.id)).toEqual(["gen-t-a-1"]);
    expect(onlyFixed(result.unplaced).map((item) => [item.entryId, item.reason])).toEqual([
      ["entry-ghost-teaching", "FIXED_UNRESOLVED"],
      ["entry-ghost-venue", "FIXED_UNRESOLVED"],
    ]);
  });

  it("works around a locked row and reports the session it cannot fit", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-locked", { lecturerId: "lecturer-1", groupId: "group-1" }), teaching("t-new", { lecturerId: "lecturer-1", groupId: "group-2" })],
      venues: [venue("venue-LH1")],
      fixedEntries: [
        { id: "entry-locked", teachingId: "t-locked", venueId: "venue-LH1", day: "MON", start: "08:00", end: "09:00" },
      ],
    };
    const result = generateTimetable(input, ONE_SLOT);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.id).toBe("entry-locked");
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]!.reason).toBe("NO_FREE_SLOT");
    expectNoHardViolations(input, result.entries);
  });

  it("places a session that only breaks a day limit rather than dropping it", () => {
    // 6 one-hour classes for one group on the one teaching day: the group limit
    // is 5 (ASSUMPTION-10), which the M3 validator scores but does not enforce.
    const input: GeneratorInput = {
      teachings: [teaching("t-many", { sessionsPerWeek: 6 })],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, MON_FULL_DAY);
    expect(result.entries).toHaveLength(6);
    expect(result.unplaced).toEqual([]);
    expect(result.softScore).toBeGreaterThan(0);
    expectNoHardViolations(input, result.entries);
  });
});

// ---------------------------------------------------------------------------
// 6. Search bound
// ---------------------------------------------------------------------------

describe("generateTimetable search bound", () => {
  it("stops at the configured step limit and reports what is left", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 3 }), teaching("t-b", { groupId: "group-G2", sessionsPerWeek: 3 })],
      venues: [venue("venue-LH1"), venue("venue-CR1", { capacity: 60 })],
      stepLimit: 5,
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries.length).toBeLessThan(6);
    const stopped = result.unplaced.filter((item) => item.reason === "STEP_LIMIT");
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped[0]!.message).toContain("5");
    expect(result.entries.length + result.unplaced.length).toBe(sessionsOwed(input));
    expectNoHardViolations(input, result.entries);
  });

  it("places nothing when the budget is zero yet still reports every session", () => {
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 2 })],
      venues: [venue("venue-LH1")],
      stepLimit: 0,
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toEqual([]);
    expect(result.unplaced).toHaveLength(2);
    expect(result.unplaced.map((item) => item.reason)).toEqual(["STEP_LIMIT", "STEP_LIMIT"]);
  });

  it("uses the documented default budget when none is given", () => {
    expect(DEFAULT_STEP_LIMIT).toBe(20_000);
    const input: GeneratorInput = {
      teachings: [teaching("t-a", { sessionsPerWeek: 4 })],
      venues: [venue("venue-LH1")],
    };
    const result = generateTimetable(input, DEFAULT_POLICY);
    expect(result.entries).toHaveLength(4);
    expect(result.unplaced).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Backtracking
// ---------------------------------------------------------------------------

describe("generateTimetable backtracking", () => {
  it("moves an earlier session when that is the only way to fit a later one", () => {
    // venue-X 08:00 is taken by a locked row, venue-Y 09:00 by another, and the
    // group of teach-B is busy at 09:00 — so teach-B can only go at venue-Y
    // 08:00, which is also teach-A's first choice. A greedy first-fit search
    // would leave teach-B unplaced; backtracking moves teach-A to venue-X 09:00.
    const input: GeneratorInput = {
      teachings: [
        teaching("teach-A", { lecturerId: "lecturer-A", groupId: "group-A", expectedSize: 60, venueTypeRequired: "LAB" }),
        teaching("teach-B", { lecturerId: "lecturer-B", groupId: "group-B", expectedSize: 60, venueTypeRequired: "LAB" }),
        teaching("teach-C", { lecturerId: "lecturer-C", groupId: "group-B", expectedSize: 60, venueTypeRequired: "LAB" }),
        teaching("teach-D", { lecturerId: "lecturer-D", groupId: "group-D", expectedSize: 60, venueTypeRequired: "LAB" }),
      ],
      venues: [
        venue("venue-X", { type: "LAB", capacity: 60 }),
        venue("venue-Y", { type: "LAB", capacity: 60 }),
      ],
      fixedEntries: [
        { id: "entry-y9", teachingId: "teach-C", venueId: "venue-Y", day: "MON", start: "09:00", end: "10:00" },
        { id: "entry-x8", teachingId: "teach-D", venueId: "venue-X", day: "MON", start: "08:00", end: "09:00" },
      ],
    };
    const result = generateTimetable(input, MON_TWO_HOURS);
    expect(result.unplaced).toEqual([]);
    expect(result.entries).toHaveLength(4);

    const rowOf = (teachingId: string): EntryInput =>
      result.entries.find((entry) => entry.teachingId === teachingId)!;
    expect(rowOf("teach-A")).toMatchObject({ venueId: "venue-X", day: "MON", start: "09:00" });
    expect(rowOf("teach-B")).toMatchObject({ venueId: "venue-Y", day: "MON", start: "08:00" });
    expect(rowOf("teach-C")).toMatchObject({ id: "entry-y9", venueId: "venue-Y", start: "09:00" });
    expect(rowOf("teach-D")).toMatchObject({ id: "entry-x8", venueId: "venue-X", start: "08:00" });
  });
});
