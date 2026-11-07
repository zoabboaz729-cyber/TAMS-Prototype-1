/**
 * M4-T4c — unit tests for the pure weekly-grid engine. No database, no React, no
 * Prisma: every case calls buildPublishedWeekGrid() with plain DisplayableEntry
 * objects and a PolicyConfig, and asserts the actual output model (positions,
 * spans, lanes, overlaps, lunch rows and typed failures), not merely `ok: true`.
 * The numbered comments map to the bundle's 45 required scenarios.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPublishedWeekGrid,
  type PublishedWeekGrid,
  type PublishedWeekGridResult,
  type PlacedSession,
} from "../publishedWeekGrid";
import { DEFAULT_POLICY, type PolicyConfig } from "../policy";
import type { DisplayableEntry } from "@/server/publishedTimetableContract";

// --- Fixtures and helpers -------------------------------------------------

const entry = (id: string, over: Partial<DisplayableEntry> = {}): DisplayableEntry => ({
  id, versionId: "ver-1", teachingId: `teach-${id}`, day: "MON", start: "08:00", end: "09:00",
  unitCode: "SOEN 413", unitTitle: "Software Architecture", groupId: "group-1", groupName: "SE-Y4",
  lecturerId: "lect-A", lecturerName: "Lecturer A", venueId: "venue-1", venueCode: "CR1", ...over,
});
const policy = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({ ...DEFAULT_POLICY, ...over });

function okGrid(result: PublishedWeekGridResult): PublishedWeekGrid {
  if (!result.ok) throw new Error(`expected a grid, got ${JSON.stringify(result)}`);
  return result.grid;
}
function session(grid: PublishedWeekGrid, id: string): PlacedSession {
  const found = grid.sessions.find((s) => s.entryId === id);
  if (!found) throw new Error(`session ${id} not found`);
  return found;
}
function failure(result: PublishedWeekGridResult): { kind: string; reason?: string; property?: string; entryId?: string } {
  if (result.ok) throw new Error("expected a typed failure, got a grid");
  return result;
}

// --- Basic construction (1–7) ---------------------------------------------

describe("basic construction", () => {
  it("1: an empty entry list is a valid empty week with days, hour rows and lunch", () => {
    const grid = okGrid(buildPublishedWeekGrid([], policy()));
    expect(grid.days.map((d) => d.day)).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(grid.days.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
    expect(grid.slots).toHaveLength(9);
    expect(grid.slots[0]).toMatchObject({ start: "08:00", end: "09:00", isLunch: false });
    expect(grid.slots[8]).toMatchObject({ start: "16:00", end: "17:00" });
    expect(grid.sessions).toEqual([]);
    expect(grid.hasOverlaps).toBe(false);
    expect(grid.slotDurationMinutes).toBe(60);
  });
  it("2: a single Monday session occupies the first hour row exactly once", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e-1")], policy()));
    expect(grid.sessions).toHaveLength(1);
    expect(session(grid, "e-1")).toMatchObject({
      day: "MON", dayIndex: 0, start: "08:00", end: "09:00", startSlotIndex: 0,
      endSlotIndex: 1, slotSpan: 1, lane: 0, laneCount: 1, overlappingEntryIds: [],
    });
  });
  it("3: sessions on different days land in their own policy-ordered columns", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e-1"), entry("e-2", { day: "TUE" })], policy()));
    expect(session(grid, "e-1").dayIndex).toBe(0);
    expect(session(grid, "e-2").dayIndex).toBe(1);
  });
  it("4: multiple sessions on one day are ordered by start and do not overlap", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("late", { start: "10:00", end: "11:00" }), entry("early")], policy()));
    expect(grid.sessions.map((s) => s.entryId)).toEqual(["early", "late"]);
    expect(grid.hasOverlaps).toBe(false);
    expect(grid.sessions.every((s) => s.laneCount === 1)).toBe(true);
  });
  it("5: day headings and session order follow the policy day order, not the calendar", () => {
    const p = policy({ days: ["WED", "MON", "TUE"] });
    const grid = okGrid(buildPublishedWeekGrid([entry("m"), entry("t", { day: "TUE" }), entry("w", { day: "WED" })], p));
    expect(grid.days.map((d) => d.day)).toEqual(["WED", "MON", "TUE"]);
    expect(grid.sessions.map((s) => s.day)).toEqual(["WED", "MON", "TUE"]);
    expect(session(grid, "w").dayIndex).toBe(0);
  });
  it("6: input order never changes the serialized grid", () => {
    const entries = [entry("a"), entry("b", { day: "TUE", start: "09:00", end: "11:00" }), entry("c", { start: "14:00", end: "15:00" })];
    const forward = buildPublishedWeekGrid(entries, policy());
    const reversed = buildPublishedWeekGrid([...entries].reverse(), policy());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
  it("7: each entry keeps one stable identity and is never duplicated across slots", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e-1", { start: "09:00", end: "11:00" })], policy()));
    expect(grid.sessions).toHaveLength(1);
    expect(session(grid, "e-1").entryId).toBe("e-1");
    expect(session(grid, "e-1").slotSpan).toBe(2);
  });
});

// --- Time and duration (8–18) ---------------------------------------------

describe("time and duration", () => {
  it("8: a one-hour session spans one slot and 60 minutes", () => {
    const s = session(okGrid(buildPublishedWeekGrid([entry("e", { start: "08:00", end: "09:00" })], policy())), "e");
    expect(s.durationMinutes).toBe(60);
    expect(s.slotSpan).toBe(1);
  });
  it("9: a two-hour session spans the full interval as one block", () => {
    const s = session(okGrid(buildPublishedWeekGrid([entry("e", { start: "09:00", end: "11:00" })], policy())), "e");
    expect(s).toMatchObject({ startMinutes: 540, endMinutes: 660, durationMinutes: 120, startSlotIndex: 1, endSlotIndex: 3, slotSpan: 2 });
  });
  it("10: a three-hour session spans three slots without splitting", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e", { start: "08:00", end: "11:00" })], policy()));
    expect(grid.sessions).toHaveLength(1);
    expect(session(grid, "e")).toMatchObject({ durationMinutes: 180, slotSpan: 3, startSlotIndex: 0, endSlotIndex: 3 });
  });
  it("11: the earliest allowed start maps to slot index zero", () => {
    expect(session(okGrid(buildPublishedWeekGrid([entry("e", { start: "08:00", end: "09:00" })], policy())), "e").startSlotIndex).toBe(0);
  });
  it("12: the latest allowed end maps to the exclusive final slot index", () => {
    const s = session(okGrid(buildPublishedWeekGrid([entry("e", { start: "16:00", end: "17:00" })], policy())), "e");
    expect(s.endMinutes).toBe(1020);
    expect(s.endSlotIndex).toBe(9);
  });
  it("13: a session crossing an internal slot boundary stays one coherent block", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e", { start: "09:00", end: "11:00" })], policy()));
    expect(grid.sessions).toHaveLength(1);
    expect(session(grid, "e")).toMatchObject({ startSlotIndex: 1, endSlotIndex: 3, slotSpan: 2 });
  });
  it("14: an invalid 24-hour time is a typed INVALID_ENTRY, never parsed by Date", () => {
    for (const start of ["25:00", "8:00", "08:60", "", "0800"]) {
      const f = failure(buildPublishedWeekGrid([entry("e", { start })], policy()));
      expect(f).toMatchObject({ kind: "INVALID_ENTRY", reason: "INVALID_TIME", entryId: "e" });
    }
  });
  it("15: zero duration is rejected", () => {
    expect(failure(buildPublishedWeekGrid([entry("e", { start: "08:00", end: "08:00" })], policy())))
      .toMatchObject({ kind: "INVALID_ENTRY", reason: "NON_POSITIVE_DURATION" });
  });
  it("16: end before start is rejected", () => {
    expect(failure(buildPublishedWeekGrid([entry("e", { start: "10:00", end: "09:00" })], policy())))
      .toMatchObject({ kind: "INVALID_ENTRY", reason: "NON_POSITIVE_DURATION" });
  });
  it("17: a session outside the teaching window is rejected", () => {
    for (const over of [{ start: "07:00", end: "08:00" }, { start: "17:00", end: "18:00" }]) {
      expect(failure(buildPublishedWeekGrid([entry("e", over)], policy())))
        .toMatchObject({ kind: "INVALID_ENTRY", reason: "OUTSIDE_WINDOW" });
    }
  });
  it("18: an off-grid start or end is rejected, never rounded to an hour", () => {
    for (const over of [{ start: "08:30", end: "09:30" }, { start: "09:00", end: "10:30" }]) {
      expect(failure(buildPublishedWeekGrid([entry("e", over)], policy())))
        .toMatchObject({ kind: "INVALID_ENTRY", reason: "OFF_GRID" });
    }
  });
});

// --- Lunch (19–23) --------------------------------------------------------

describe("lunch handling", () => {
  it("19: the lunch interval is a visible non-teaching row, not removed", () => {
    const grid = okGrid(buildPublishedWeekGrid([], policy()));
    const lunch = grid.slots.filter((s) => s.isLunch);
    expect(lunch).toHaveLength(1);
    expect(lunch[0]).toMatchObject({ start: "13:00", end: "14:00", index: 5 });
  });
  it("20: a session ending exactly when lunch begins is valid", () => {
    expect(buildPublishedWeekGrid([entry("e", { start: "12:00", end: "13:00" })], policy()).ok).toBe(true);
  });
  it("21: a session beginning exactly when lunch ends is valid", () => {
    expect(buildPublishedWeekGrid([entry("e", { start: "14:00", end: "15:00" })], policy()).ok).toBe(true);
  });
  it("22: an hour-aligned session overlapping lunch is a typed invalid entry", () => {
    expect(failure(buildPublishedWeekGrid([entry("e", { start: "12:00", end: "14:00" })], policy())))
      .toMatchObject({ kind: "INVALID_ENTRY", reason: "LUNCH_OVERLAP", entryId: "e" });
  });
  it("23: an alternate valid lunch policy moves the row and the rejection boundary", () => {
    const p = policy({ lunchStart: "12:00", lunchEnd: "13:00" });
    const grid = okGrid(buildPublishedWeekGrid([entry("ok", { start: "13:00", end: "14:00" })], p));
    expect(grid.slots.find((s) => s.isLunch)).toMatchObject({ start: "12:00", end: "13:00" });
    expect(failure(buildPublishedWeekGrid([entry("bad", { start: "12:00", end: "13:00" })], p)))
      .toMatchObject({ reason: "LUNCH_OVERLAP" });
  });
  it("marks every hour of a multi-hour lunch as non-teaching", () => {
    const grid = okGrid(buildPublishedWeekGrid([], policy({ lunchStart: "12:00", lunchEnd: "14:00" })));
    expect(grid.slots.filter((s) => s.isLunch).map((s) => s.start)).toEqual(["12:00", "13:00"]);
  });
});

// --- Overlaps (24–30) -----------------------------------------------------

describe("overlapping sessions", () => {
  it("24: exact duplicate intervals with distinct ids are both preserved and lane-split", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("e-a"), entry("e-b")], policy()));
    expect(grid.sessions.map((s) => s.entryId)).toEqual(["e-a", "e-b"]);
    expect(grid.hasOverlaps).toBe(true);
    expect(session(grid, "e-a")).toMatchObject({ lane: 0, laneCount: 2, overlappingEntryIds: ["e-b"] });
    expect(session(grid, "e-b")).toMatchObject({ lane: 1, laneCount: 2, overlappingEntryIds: ["e-a"] });
  });
  it("25: a partial overlap keeps both entries and marks them", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("a", { start: "08:00", end: "10:00" }), entry("b", { start: "09:00", end: "11:00" })], policy()));
    expect(grid.hasOverlaps).toBe(true);
    expect(session(grid, "a").overlappingEntryIds).toEqual(["b"]);
    expect(session(grid, "b").overlappingEntryIds).toEqual(["a"]);
    expect(session(grid, "a").laneCount).toBe(2);
  });
  it("26: a nested overlap keeps both entries in two lanes", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("outer", { start: "08:00", end: "12:00" }), entry("inner", { start: "09:00", end: "10:00" })], policy()));
    expect(grid.sessions).toHaveLength(2);
    expect(session(grid, "inner").laneCount).toBe(2);
    expect(session(grid, "outer").overlappingEntryIds).toEqual(["inner"]);
  });
  it("27: a chain of overlaps forms one cluster with peak-concurrency lanes", () => {
    const grid = okGrid(buildPublishedWeekGrid([
      entry("a", { start: "08:00", end: "10:00" }), entry("b", { start: "09:00", end: "11:00" }), entry("c", { start: "10:00", end: "12:00" }),
    ], policy()));
    expect(session(grid, "a").overlappingEntryIds).toEqual(["b"]);
    expect(session(grid, "b").overlappingEntryIds).toEqual(["a", "c"]);
    expect(session(grid, "c").overlappingEntryIds).toEqual(["b"]);
    expect(grid.sessions.every((s) => s.laneCount === 2)).toBe(true);
    expect([session(grid, "a").lane, session(grid, "b").lane, session(grid, "c").lane]).toEqual([0, 1, 0]);
  });
  it("28: adjacent nonoverlapping sessions are not marked as a conflict", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("a", { start: "08:00", end: "09:00" }), entry("b", { start: "09:00", end: "10:00" })], policy()));
    expect(grid.hasOverlaps).toBe(false);
    expect(grid.sessions.every((s) => s.overlappingEntryIds.length === 0 && s.laneCount === 1)).toBe(true);
  });
  it("29: lane assignment is identical whichever order the entries arrive in", () => {
    const entries = [entry("e-a"), entry("e-b"), entry("e-c", { start: "08:00", end: "09:00" })];
    const forward = okGrid(buildPublishedWeekGrid(entries, policy()));
    const reversed = okGrid(buildPublishedWeekGrid([...entries].reverse(), policy()));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(session(forward, "e-a").lane).toBe(0);
    expect(session(forward, "e-b").lane).toBe(1);
    expect(session(forward, "e-c").lane).toBe(2);
  });
  it("30: a successful grid with overlaps is never presented as conflict-free", () => {
    const grid = okGrid(buildPublishedWeekGrid([entry("a"), entry("b")], policy()));
    expect(grid.sessions).toHaveLength(2);
    expect(grid.hasOverlaps).toBe(true);
  });
});

// --- Policy and corruption (31–40) ----------------------------------------

describe("policy configuration and corrupt data", () => {
  it("31: a custom day set extends the grid columns and accepts that day", () => {
    const p = policy({ days: ["MON", "TUE", "WED", "THU", "FRI", "SAT"] });
    const grid = okGrid(buildPublishedWeekGrid([entry("e", { day: "SAT" })], p));
    expect(grid.days.map((d) => d.day)).toContain("SAT");
    expect(session(grid, "e").dayIndex).toBe(5);
  });
  it("32: custom working hours rebuild the hour rows and slot indices", () => {
    const p = policy({ slotStart: "09:00", slotEnd: "15:00", lunchStart: "12:00", lunchEnd: "13:00" });
    const grid = okGrid(buildPublishedWeekGrid([entry("e", { start: "09:00", end: "10:00" })], p));
    expect(grid.slots).toHaveLength(6);
    expect(grid.slots[0]).toMatchObject({ start: "09:00", end: "10:00" });
    expect(session(grid, "e").startSlotIndex).toBe(0);
  });
  it("33: an empty teaching-day list is an invalid policy", () => {
    expect(failure(buildPublishedWeekGrid([], policy({ days: [] })))).toMatchObject({ kind: "INVALID_POLICY", property: "days" });
  });
  it("34: duplicate teaching days are an invalid policy", () => {
    expect(failure(buildPublishedWeekGrid([], policy({ days: ["MON", "MON"] })))).toMatchObject({ kind: "INVALID_POLICY", property: "days" });
  });
  it("35: an invalid or off-hour policy time is an invalid policy naming the property", () => {
    expect(failure(buildPublishedWeekGrid([], policy({ slotStart: "25:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "slotStart" });
    expect(failure(buildPublishedWeekGrid([], policy({ slotStart: "08:30" })))).toMatchObject({ kind: "INVALID_POLICY", property: "slotStart" });
    expect(failure(buildPublishedWeekGrid([], policy({ slotEnd: "17:30" })))).toMatchObject({ kind: "INVALID_POLICY", property: "slotEnd" });
  });
  it("35b: earliest start not before latest end is an invalid policy", () => {
    expect(failure(buildPublishedWeekGrid([], policy({ slotStart: "17:00", slotEnd: "17:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "slotStart" });
    expect(failure(buildPublishedWeekGrid([], policy({ slotStart: "17:00", slotEnd: "08:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "slotStart" });
  });
  it("36: an invalid or out-of-window lunch interval is an invalid policy", () => {
    expect(failure(buildPublishedWeekGrid([], policy({ lunchStart: "14:00", lunchEnd: "13:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "lunchStart" });
    expect(failure(buildPublishedWeekGrid([], policy({ lunchStart: "07:00", lunchEnd: "08:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "lunchStart" });
    expect(failure(buildPublishedWeekGrid([], policy({ lunchStart: "17:00", lunchEnd: "18:00" })))).toMatchObject({ kind: "INVALID_POLICY", property: "lunchEnd" });
  });
  it("37: an entry on an unsupported day is a typed invalid entry", () => {
    expect(failure(buildPublishedWeekGrid([entry("e", { day: "SAT" })], policy())))
      .toMatchObject({ kind: "INVALID_ENTRY", reason: "UNSUPPORTED_DAY", entryId: "e" });
  });
  it("38: a missing or blank entry id is a typed invalid entry", () => {
    for (const id of ["", "   "]) {
      expect(failure(buildPublishedWeekGrid([entry(id)], policy()))).toMatchObject({ kind: "INVALID_ENTRY", reason: "MISSING_ID" });
    }
  });
  it("39: a duplicate entry id is a typed invalid entry", () => {
    expect(failure(buildPublishedWeekGrid([entry("dup"), entry("dup", { day: "TUE" })], policy())))
      .toMatchObject({ kind: "INVALID_ENTRY", reason: "DUPLICATE_ID", entryId: "dup" });
  });
  it("40: one invalid entry fails the whole grid — no partial success", () => {
    const result = buildPublishedWeekGrid([entry("good"), entry("bad", { start: "99:99" })], policy());
    expect(result.ok).toBe(false);
    expect(failure(result)).toMatchObject({ kind: "INVALID_ENTRY", entryId: "bad" });
  });
  it("40b: the chosen offender is independent of input order", () => {
    const entries = [entry("good"), entry("bad", { start: "99:99" })];
    expect(JSON.stringify(buildPublishedWeekGrid([...entries].reverse(), policy())))
      .toBe(JSON.stringify(buildPublishedWeekGrid(entries, policy())));
  });
});

// --- Integration with the accepted data shape (41–45) ---------------------

describe("accepted DisplayableEntry integration", () => {
  it("41,42,43: preserves every display label and the version/teaching ids", () => {
    const source = entry("e-1", { start: "09:00", end: "11:00" });
    const s = session(okGrid(buildPublishedWeekGrid([source], policy())), "e-1");
    expect(s).toMatchObject({
      entryId: "e-1", versionId: "ver-1", teachingId: "teach-e-1", unitCode: "SOEN 413",
      unitTitle: "Software Architecture", groupId: "group-1", groupName: "SE-Y4",
      lecturerId: "lect-A", lecturerName: "Lecturer A", venueId: "venue-1", venueCode: "CR1",
    });
  });
  it("44: many valid entries remain count-identical in the grid", () => {
    const entries = [entry("a"), entry("b", { day: "TUE" }), entry("c", { day: "WED", start: "14:00", end: "16:00" }), entry("d", { day: "THU", start: "10:00", end: "11:00" })];
    const grid = okGrid(buildPublishedWeekGrid(entries, policy()));
    expect(grid.sessions).toHaveLength(entries.length);
    expect(grid.sessions.map((s) => s.entryId).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("never mutates the entries, their objects or the policy", () => {
    const entries = [entry("a"), entry("b", { start: "08:00", end: "09:00" })];
    const p = policy();
    const beforeEntries = JSON.stringify(entries);
    const beforePolicy = JSON.stringify(p);
    entries.forEach((e) => Object.freeze(e));
    Object.freeze(entries);
    Object.freeze(p);
    expect(buildPublishedWeekGrid(entries, p).ok).toBe(true);
    expect(JSON.stringify(entries)).toBe(beforeEntries);
    expect(JSON.stringify(p)).toBe(beforePolicy);
  });
  it("45: the engine introduces no React, Next.js, Prisma or database dependency", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/publishedWeekGrid.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.trimStart().startsWith("import")).join("\n");
    expect(imports).not.toContain("react");
    expect(imports).not.toContain("next/");
    expect(imports).not.toContain("@prisma/client");
    expect(imports).not.toContain("@/server/db");
    expect(imports).not.toMatch(/from "\.\/db"/);
    const serverImports = imports.split("\n").filter((line) => line.includes("@/server"));
    expect(serverImports).toHaveLength(1);
    expect(serverImports[0]).toMatch(/^import type /);
    expect(source).not.toContain("Date.now(");
    expect(source).not.toContain("Math.random(");
    expect(source).not.toContain("process.env");
  });
});