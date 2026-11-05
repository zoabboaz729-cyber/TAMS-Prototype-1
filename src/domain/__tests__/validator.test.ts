import { describe, it, expect } from "vitest";
import {
  validateEntries,
  type EntryInput,
  type ValidationContext,
  type VenueUnavailablePeriod,
} from "../validator";
import { DEFAULT_POLICY } from "../policy";
import { type StoredUnavailablePeriod } from "../lecturerAvailability";
import {
  seedTeachings,
  seedVenues,
  seedUnits,
  seedLecturerAvailabilities,
  seedVenueUnavailabilities,
  seedTimetableEntries,
} from "../seedData";

// ---------------------------------------------------------------------------
// Helpers — build a ValidationContext from seed data
// ---------------------------------------------------------------------------

function buildTeachings(): Record<string, ValidationContext["teachings"][string]> {
  const unitMap = new Map(seedUnits.map((u) => [u.id, u]));
  const result: Record<string, ValidationContext["teachings"][string]> = {};
  for (const t of seedTeachings) {
    const unit = unitMap.get(t.unitId)!;
    result[t.id] = {
      lecturerId: t.lecturerId,
      groupId: t.groupId,
      expectedSize: t.expectedSize,
      venueTypeRequired: unit.venueTypeRequired,
      unitCode: unit.code,
    };
  }
  return result;
}

function buildVenues(): Record<string, ValidationContext["venues"][string]> {
  const result: Record<string, ValidationContext["venues"][string]> = {};
  for (const v of seedVenues) {
    result[v.id] = { capacity: v.capacity, type: v.type, code: v.code };
  }
  return result;
}

function buildLecturerUnavailable(): Record<string, StoredUnavailablePeriod[]> {
  const result: Record<string, StoredUnavailablePeriod[]> = {};
  for (const la of seedLecturerAvailabilities) {
    if (la.available !== false) continue;
    if (!result[la.lecturerId]) result[la.lecturerId] = [];
    result[la.lecturerId].push({
      id: la.id,
      day: la.day,
      start: la.start,
      end: la.end,
    });
  }
  return result;
}

function buildVenueUnavailable(): Record<string, VenueUnavailablePeriod[]> {
  const result: Record<string, VenueUnavailablePeriod[]> = {};
  for (const vu of seedVenueUnavailabilities) {
    if (!result[vu.venueId]) result[vu.venueId] = [];
    result[vu.venueId].push({
      day: vu.day,
      start: vu.start,
      end: vu.end,
      reason: vu.reason,
    });
  }
  return result;
}

function buildSeedContext(): ValidationContext {
  return {
    teachings: buildTeachings(),
    venues: buildVenues(),
    lecturerUnavailable: buildLecturerUnavailable(),
    venueUnavailable: buildVenueUnavailable(),
  };
}

function seedEntries(): EntryInput[] {
  return seedTimetableEntries.map((e) => ({
    id: e.id,
    teachingId: e.teachingId,
    venueId: e.venueId,
    day: e.day,
    start: e.start,
    end: e.end,
  }));
}

/** Create an entry with safe defaults that produce no violations. */
function makeEntry(id: string, overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    id,
    // teach-SE-Y4-SOEN413: lecturer-A, group-SE-Y4, expectedSize 45, requires ROOM
    teachingId: "teach-SE-Y4-SOEN413",
    // venue-CR1: ROOM, capacity 60 (>= 45), no unavailabilities
    venueId: "venue-CR1",
    day: "WED",
    start: "09:00",
    end: "10:00",
    ...overrides,
  };
}

const POLICY = DEFAULT_POLICY;
const CTX = buildSeedContext();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateEntries", () => {
  // ---- Clean case ----------------------------------------------------------

  it("returns no violations for the six clean seed entries", () => {
    const clean = seedEntries().filter((e) => e.id.startsWith("entry-clean-"));
    expect(clean).toHaveLength(6);
    expect(validateEntries(clean, CTX, POLICY)).toEqual([]);
  });

  // ---- VENUE_OVERLAP --------------------------------------------------------

  it("VENUE_OVERLAP: detects two entries at the same venue at the same time", () => {
    const entries = [
      makeEntry("vo-1", { teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "MON", start: "08:00", end: "09:00" }),
      // teach-SE-Y1-SE101: lecturer-B, group-SE-Y1 — different lecturer and group
      makeEntry("vo-2", { teachingId: "teach-SE-Y1-SE101", venueId: "venue-CR1", day: "MON", start: "08:00", end: "09:00" }),
    ];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("VENUE_OVERLAP");
    expect(v[0].entryId).toBe("vo-1");
    expect(v[0].conflictEntryId).toBe("vo-2");
    expect(v[0].message).toContain("CR1");
  });

  it("VENUE_OVERLAP: does not flag adjacent entries at the same venue", () => {
    const entries = [
      makeEntry("vo-3", { venueId: "venue-CR1", day: "MON", start: "08:00", end: "09:00" }),
      makeEntry("vo-4", { teachingId: "teach-SE-Y1-SE101", venueId: "venue-CR1", day: "MON", start: "09:00", end: "10:00" }),
    ];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- LECTURER_OVERLAP -----------------------------------------------------

  it("LECTURER_OVERLAP: detects two entries with the same lecturer at the same time", () => {
    const entries = [
      // Both lecturer-A but different groups and venues
      makeEntry("lo-1", { teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" }),
      makeEntry("lo-2", { teachingId: "teach-CS-Y2-CS201", venueId: "venue-CR2", day: "WED", start: "09:00", end: "10:00" }),
    ];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("LECTURER_OVERLAP");
    expect(v[0].entryId).toBe("lo-1");
    expect(v[0].conflictEntryId).toBe("lo-2");
  });

  it("LECTURER_OVERLAP: does not flag the same lecturer on different days", () => {
    const entries = [
      makeEntry("lo-3", { teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" }),
      makeEntry("lo-4", { teachingId: "teach-CS-Y2-CS201", venueId: "venue-CR2", day: "THU", start: "09:00", end: "10:00" }),
    ];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- GROUP_OVERLAP --------------------------------------------------------

  it("GROUP_OVERLAP: detects two entries with the same group at the same time", () => {
    const entries = [
      // Both group-SE-Y4 but different lecturers and venues
      makeEntry("go-1", { teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" }),
      // teach-SE-Y4-SOEN415: lecturer-B, group-SE-Y4
      makeEntry("go-2", { teachingId: "teach-SE-Y4-SOEN415", venueId: "venue-CR2", day: "WED", start: "09:00", end: "10:00" }),
    ];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("GROUP_OVERLAP");
    expect(v[0].entryId).toBe("go-1");
    expect(v[0].conflictEntryId).toBe("go-2");
  });

  it("GROUP_OVERLAP: does not flag the same group on different days", () => {
    const entries = [
      makeEntry("go-3", { teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" }),
      makeEntry("go-4", { teachingId: "teach-SE-Y4-SOEN415", venueId: "venue-CR2", day: "THU", start: "09:00", end: "10:00" }),
    ];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- CAPACITY -------------------------------------------------------------

  it("CAPACITY: detects when venue capacity is less than expected size", () => {
    // CR3 capacity 40 < expectedSize 45
    const entries = [makeEntry("cap-1", { venueId: "venue-CR3", day: "WED", start: "09:00", end: "10:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("CAPACITY");
    expect(v[0].message).toContain("40");
    expect(v[0].message).toContain("45");
  });

  it("CAPACITY: does not flag when venue capacity equals expected size", () => {
    // CR1 capacity 60 = teach-SE-Y1-SE101 expectedSize 60 (>= is allowed)
    const entries = [makeEntry("cap-2", { teachingId: "teach-SE-Y1-SE101", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" })];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- VENUE_TYPE -----------------------------------------------------------

  it("VENUE_TYPE: detects when venue type does not match required type", () => {
    // SOEN 400 requires LAB, CR1 is ROOM
    const entries = [makeEntry("vt-1", { teachingId: "teach-SE-Y4-SOEN400", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("VENUE_TYPE");
    expect(v[0].message).toContain("ROOM");
    expect(v[0].message).toContain("LAB");
  });

  it("VENUE_TYPE: does not flag when venue type matches required type", () => {
    // SOEN 413 requires ROOM, CR1 is ROOM
    const entries = [makeEntry("vt-2", { venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" })];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- LECTURER_UNAVAILABLE -------------------------------------------------

  it("LECTURER_UNAVAILABLE: detects an entry during a lecturer's unavailable period", () => {
    // Lecturer A is unavailable MON 15:00-17:00
    const entries = [makeEntry("lu-1", { day: "MON", start: "15:00", end: "16:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("LECTURER_UNAVAILABLE");
    expect(v[0].message).toContain("MON");
    expect(v[0].message).toContain("15:00");
    expect(v[0].message).toContain("17:00");
  });

  it("LECTURER_UNAVAILABLE: does not flag an entry adjacent to the unavailable period", () => {
    // Entry ends at 15:00, unavailability starts at 15:00 (half-open, no overlap)
    const entries = [makeEntry("lu-2", { day: "MON", start: "14:00", end: "15:00" })];
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- VENUE_UNAVAILABLE ----------------------------------------------------

  it("VENUE_UNAVAILABLE: detects an entry during a venue's unavailable period", () => {
    // LH1 is unavailable FRI 14:00-17:00. Override LH1 type to ROOM to isolate
    // the VENUE_UNAVAILABLE violation (no unit requires HALL in the seed data).
    const ctx = buildSeedContext();
    ctx.venues["venue-LH1"] = { capacity: 150, type: "ROOM", code: "LH1" };
    const entries = [makeEntry("vu-1", { venueId: "venue-LH1", day: "FRI", start: "14:00", end: "15:00" })];
    const v = validateEntries(entries, ctx, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("VENUE_UNAVAILABLE");
    expect(v[0].message).toContain("LH1");
    expect(v[0].message).toContain("FRI");
  });

  it("VENUE_UNAVAILABLE: does not flag an entry before the unavailable period", () => {
    const ctx = buildSeedContext();
    ctx.venues["venue-LH1"] = { capacity: 150, type: "ROOM", code: "LH1" };
    const entries = [makeEntry("vu-2", { venueId: "venue-LH1", day: "FRI", start: "10:00", end: "11:00" })];
    expect(validateEntries(entries, ctx, POLICY)).toEqual([]);
  });

  // ---- OUT_OF_SLOT ----------------------------------------------------------

  it("OUT_OF_SLOT: detects an entry on a non-teaching day", () => {
    const entries = [makeEntry("os-1", { day: "SAT", start: "08:00", end: "09:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("OUT_OF_SLOT");
    expect(v[0].message).toContain("not a teaching day");
  });

  it("OUT_OF_SLOT: detects an entry starting before the slot window", () => {
    const entries = [makeEntry("os-2", { day: "WED", start: "07:00", end: "08:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("OUT_OF_SLOT");
    expect(v[0].message).toContain("earliest slot");
  });

  it("OUT_OF_SLOT: detects an entry overlapping the lunch break", () => {
    const entries = [makeEntry("os-3", { day: "WED", start: "12:00", end: "14:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("OUT_OF_SLOT");
    expect(v[0].message).toContain("lunch");
  });

  // ---- Multiple violations on one entry ------------------------------------

  it("can report multiple violations for a single entry", () => {
    // SOEN 400 requires LAB, CR3 is ROOM (VENUE_TYPE), CR3 capacity 40 < 45 (CAPACITY)
    const entries = [makeEntry("multi-1", { teachingId: "teach-SE-Y4-SOEN400", venueId: "venue-CR3", day: "WED", start: "09:00", end: "10:00" })];
    const v = validateEntries(entries, CTX, POLICY);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.type).sort()).toEqual(["CAPACITY", "VENUE_TYPE"]);
  });

  // ---- Missing context data -------------------------------------------------

  it("skips dependent checks when teaching or venue is not in context", () => {
    const entries = [
      makeEntry("mc-1", { teachingId: "no-such-teaching", venueId: "no-such-venue", day: "WED", start: "09:00", end: "10:00" }),
    ];
    // OUT_OF_SLOT still runs (WED 09:00-10:00 is valid); all other checks are
    // skipped because teaching/venue lookups return undefined.
    expect(validateEntries(entries, CTX, POLICY)).toEqual([]);
  });

  // ---- Seed planted conflicts -----------------------------------------------

  it("detects both planted conflicts in the seed timetable", () => {
    const v = validateEntries(seedEntries(), CTX, POLICY);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.type).sort()).toEqual(["LECTURER_OVERLAP", "VENUE_OVERLAP"]);

    const venueViolation = v.find((x) => x.type === "VENUE_OVERLAP")!;
    expect(venueViolation.entryId).toBe("entry-planted-venue-1");
    expect(venueViolation.conflictEntryId).toBe("entry-planted-venue-2");

    const lecturerViolation = v.find((x) => x.type === "LECTURER_OVERLAP")!;
    expect(lecturerViolation.entryId).toBe("entry-planted-lecturer-1");
    expect(lecturerViolation.conflictEntryId).toBe("entry-planted-lecturer-2");
  });
});
