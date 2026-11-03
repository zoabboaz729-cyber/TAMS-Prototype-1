import { describe, expect, it } from "vitest";
import {
  decideNewUnavailablePeriod,
  findUnavailableConflict,
  parseUnavailablePeriod,
  periodsOverlap,
  timesOverlap,
  unavailablePeriodsFromRecords,
  PERIOD_DAY_ERROR,
  PERIOD_ORDER_ERROR,
  PERIOD_REQUIRED_ERROR,
  PERIOD_TIME_ERROR,
  type AvailabilityRecord,
  type StoredUnavailablePeriod,
} from "../lecturerAvailability";
import {
  seedLecturerAvailabilities,
  seedTeachings,
  seedTimetableEntries,
} from "../seedData";
import { DAYS, TIME_HHMM_REGEX, type Day } from "../types";

const monAfternoon: StoredUnavailablePeriod = {
  id: "existing-1",
  day: "MON",
  start: "13:00",
  end: "14:00",
};

function stored(id: string, day: Day, start: string, end: string): StoredUnavailablePeriod {
  return { id, day, start, end };
}

function record(overrides: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return { id: "r-1", day: "MON", start: "13:00", end: "14:00", available: false, ...overrides };
}

describe("parseUnavailablePeriod — accepted input", () => {
  it("accepts a normal weekday period", () => {
    expect(parseUnavailablePeriod({ day: "MON", start: "13:00", end: "14:00" })).toEqual({
      ok: true,
      period: { day: "MON", start: "13:00", end: "14:00" },
    });
  });

  it("accepts the earliest and latest representable times", () => {
    expect(parseUnavailablePeriod({ day: "MON", start: "00:00", end: "23:59" })).toEqual({
      ok: true,
      period: { day: "MON", start: "00:00", end: "23:59" },
    });
    expect(parseUnavailablePeriod({ day: "FRI", start: "08:00", end: "17:00" })).toEqual({
      ok: true,
      period: { day: "FRI", start: "08:00", end: "17:00" },
    });
  });

  it("accepts every weekday", () => {
    for (const day of DAYS) {
      expect(parseUnavailablePeriod({ day, start: "09:00", end: "10:00" })).toEqual({
        ok: true,
        period: { day, start: "09:00", end: "10:00" },
      });
    }
  });

  it("does not mutate the supplied object", () => {
    const input = { day: "MON", start: "13:00", end: "14:00" };
    const before = JSON.parse(JSON.stringify(input));
    parseUnavailablePeriod(input);
    expect(input).toEqual(before);
  });
});

describe("parseUnavailablePeriod — rejected input", () => {
  it("rejects an empty period and a whole-day period (start must precede end)", () => {
    expect(parseUnavailablePeriod({ day: "MON", start: "14:00", end: "14:00" })).toEqual({
      ok: false,
      errors: { end: PERIOD_ORDER_ERROR },
    });
    expect(parseUnavailablePeriod({ day: "MON", start: "15:00", end: "09:00" })).toEqual({
      ok: false,
      errors: { end: PERIOD_ORDER_ERROR },
    });
  });

  it("rejects days outside MON-FRI", () => {
    expect(parseUnavailablePeriod({ day: "SAT", start: "09:00", end: "10:00" })).toEqual({
      ok: false,
      errors: { day: PERIOD_DAY_ERROR },
    });
    expect(parseUnavailablePeriod({ day: "mon", start: "09:00", end: "10:00" })).toEqual({
      ok: false,
      errors: { day: PERIOD_DAY_ERROR },
    });
    expect(parseUnavailablePeriod({ day: "", start: "09:00", end: "10:00" })).toEqual({
      ok: false,
      errors: { day: PERIOD_DAY_ERROR },
    });
  });

  it("rejects a day that is not a string as missing", () => {
    expect(parseUnavailablePeriod({ day: 1, start: "09:00", end: "10:00" })).toEqual({
      ok: false,
      errors: { day: PERIOD_REQUIRED_ERROR },
    });
    expect(parseUnavailablePeriod({ start: "09:00", end: "10:00" })).toEqual({
      ok: false,
      errors: { day: PERIOD_REQUIRED_ERROR },
    });
  });

  it("rejects malformed times", () => {
    for (const bad of ["9:00", "24:00", "13:60", "1300", "13:00:00", ""]) {
      expect(parseUnavailablePeriod({ day: "MON", start: bad, end: "15:00" })).toEqual({
        ok: false,
        errors: { start: PERIOD_TIME_ERROR },
      });
      expect(parseUnavailablePeriod({ day: "MON", start: "09:00", end: bad })).toEqual({
        ok: false,
        errors: { end: PERIOD_TIME_ERROR },
      });
    }
  });

  it("rejects non-string times as missing", () => {
    expect(
      parseUnavailablePeriod({ day: "MON", start: new Date("2026-11-04"), end: "15:00" }),
    ).toEqual({ ok: false, errors: { start: PERIOD_REQUIRED_ERROR } });
    expect(parseUnavailablePeriod({ day: "MON", end: 15 })).toEqual({
      ok: false,
      errors: { start: PERIOD_REQUIRED_ERROR, end: PERIOD_REQUIRED_ERROR },
    });
  });

  it("reports every problem it finds", () => {
    const result = parseUnavailablePeriod({ day: "SAT", start: "9:00", end: "25:00" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.day).toBe(PERIOD_DAY_ERROR);
    expect(result.errors.start).toBe(PERIOD_TIME_ERROR);
    expect(result.errors.end).toBe(PERIOD_TIME_ERROR);
  });

  it("treats non-object input as a whole-form problem", () => {
    for (const junk of [null, undefined, "MON", 42, [], ["MON", "13:00", "14:00"]]) {
      expect(parseUnavailablePeriod(junk)).toEqual({
        ok: false,
        errors: { period: PERIOD_REQUIRED_ERROR },
      });
    }
  });
});

describe("timesOverlap — half-open ranges", () => {
  it("detects a partial overlap in both directions", () => {
    expect(timesOverlap("13:00", "14:00", "13:30", "14:30")).toBe(true);
    expect(timesOverlap("13:30", "14:30", "13:00", "14:00")).toBe(true);
  });

  it("detects containment and identity", () => {
    expect(timesOverlap("08:00", "17:00", "10:00", "11:00")).toBe(true);
    expect(timesOverlap("10:00", "11:00", "08:00", "17:00")).toBe(true);
    expect(timesOverlap("10:00", "11:00", "10:00", "11:00")).toBe(true);
  });

  it("allows adjacent periods at the boundary", () => {
    expect(timesOverlap("13:00", "14:00", "14:00", "15:00")).toBe(false);
    expect(timesOverlap("14:00", "15:00", "13:00", "14:00")).toBe(false);
    expect(timesOverlap("08:00", "17:00", "17:00", "23:59")).toBe(false);
  });

  it("allows disjoint periods", () => {
    expect(timesOverlap("08:00", "09:00", "15:00", "17:00")).toBe(false);
    expect(timesOverlap("15:00", "17:00", "08:00", "09:00")).toBe(false);
  });

  it("never overlaps when a time is malformed", () => {
    expect(timesOverlap("9:00", "14:00", "13:00", "15:00")).toBe(false);
    expect(timesOverlap("13:00", "25:00", "13:30", "15:00")).toBe(false);
    expect(timesOverlap("", "", "13:00", "14:00")).toBe(false);
  });
});

describe("periodsOverlap — same day only", () => {
  it("overlaps only on the same day", () => {
    expect(periodsOverlap({ day: "MON", start: "13:00", end: "14:00" }, monAfternoon)).toBe(true);
    expect(
      periodsOverlap({ day: "TUE", start: "13:00", end: "14:00" }, { ...monAfternoon, day: "MON" }),
    ).toBe(false);
  });

  it("does not overlap when only the edges touch", () => {
    expect(periodsOverlap({ day: "MON", start: "14:00", end: "15:00" }, monAfternoon)).toBe(false);
    expect(periodsOverlap({ day: "MON", start: "12:00", end: "13:00" }, monAfternoon)).toBe(false);
  });
});

describe("decideNewUnavailablePeriod", () => {
  it("allows a period when the lecturer has none saved", () => {
    expect(decideNewUnavailablePeriod({ day: "MON", start: "13:00", end: "14:00" }, [])).toEqual({
      status: "ALLOW",
      period: { day: "MON", start: "13:00", end: "14:00" },
    });
  });

  it("allows an adjacent period", () => {
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "14:00", end: "15:00" }, [monAfternoon]),
    ).toEqual({ status: "ALLOW", period: { day: "MON", start: "14:00", end: "15:00" } });
  });

  it("allows the same times on a different day", () => {
    expect(
      decideNewUnavailablePeriod({ day: "TUE", start: "13:00", end: "14:00" }, [monAfternoon]),
    ).toEqual({ status: "ALLOW", period: { day: "TUE", start: "13:00", end: "14:00" } });
  });

  it("rejects an exact duplicate and names the stored row", () => {
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "13:00", end: "14:00" }, [monAfternoon]),
    ).toEqual({ status: "DUPLICATE", conflictingPeriod: monAfternoon });
  });

  it("rejects a partially overlapping period", () => {
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "13:30", end: "14:30" }, [monAfternoon]),
    ).toEqual({ status: "OVERLAPS", conflictingPeriod: monAfternoon });
  });

  it("rejects a period that covers a saved one, and one covered by a saved one", () => {
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "12:00", end: "15:00" }, [monAfternoon])
        .status,
    ).toBe("OVERLAPS");
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "13:15", end: "13:45" }, [monAfternoon])
        .status,
    ).toBe("OVERLAPS");
  });

  it("keeps checking later rows only after the first conflict, reporting the earliest", () => {
    const existing = [monAfternoon, stored("existing-2", "MON", "14:30", "15:30")];
    const decision = decideNewUnavailablePeriod(
      { day: "MON", start: "12:00", end: "16:00" },
      existing,
    );
    expect(decision).toEqual({ status: "OVERLAPS", conflictingPeriod: monAfternoon });
  });

  it("only checks the days it shares with the new period", () => {
    const existing = [monAfternoon, stored("existing-2", "FRI", "14:00", "17:00")];
    expect(
      decideNewUnavailablePeriod({ day: "FRI", start: "12:00", end: "16:00" }, existing),
    ).toEqual({ status: "OVERLAPS", conflictingPeriod: existing[1] });
    expect(
      decideNewUnavailablePeriod({ day: "WED", start: "08:00", end: "17:00" }, existing),
    ).toEqual({ status: "ALLOW", period: { day: "WED", start: "08:00", end: "17:00" } });
  });

  it("reports invalid input instead of a conflict", () => {
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "13:00", end: "13:00" }, [monAfternoon]),
    ).toEqual({ status: "INVALID", errors: { end: PERIOD_ORDER_ERROR } });
    expect(
      decideNewUnavailablePeriod({ day: "MON", start: "13:30", end: "14:3" }, []),
    ).toEqual({ status: "INVALID", errors: { end: PERIOD_TIME_ERROR } });
    expect(
      decideNewUnavailablePeriod({ day: "SAT", start: "13:30", end: "14:30" }, [monAfternoon]),
    ).toEqual({ status: "INVALID", errors: { day: PERIOD_DAY_ERROR } });
  });

  it("does not mutate or reorder the supplied rows", () => {
    const existing = [monAfternoon, stored("existing-2", "TUE", "08:00", "09:00")];
    const snapshot = JSON.parse(JSON.stringify(existing));
    decideNewUnavailablePeriod({ day: "MON", start: "13:30", end: "14:30" }, existing);
    expect(existing).toEqual(snapshot);
    expect(existing.map((item) => item.id)).toEqual(["existing-1", "existing-2"]);
  });
});

describe("unavailablePeriodsFromRecords", () => {
  it("keeps only rows that mean cannot teach", () => {
    const records = [
      record(),
      record({ id: "r-2", available: true }),
      record({ id: "r-3", day: "FRI", start: "14:00", end: "17:00" }),
    ];
    expect(unavailablePeriodsFromRecords(records)).toEqual([
      { id: "r-1", day: "MON", start: "13:00", end: "14:00" },
      { id: "r-3", day: "FRI", start: "14:00", end: "17:00" },
    ]);
  });

  it("drops rows that carry no usable restriction", () => {
    const junk = [
      record({ id: "bad-day", day: "SAT" }),
      record({ id: "bad-time", start: "9:00" }),
      record({ id: "empty-time", end: "" }),
      record({ id: "reversed", start: "16:00", end: "09:00" }),
      record({ id: "zero-length", start: "13:00", end: "13:00" }),
    ];
    expect(unavailablePeriodsFromRecords(junk)).toEqual([]);
  });

  it("preserves input order, builds new objects and leaves the rows untouched", () => {
    const records = [
      record({ id: "first", day: "MON", start: "08:00", end: "09:00" }),
      record({ id: "second", day: "FRI", start: "14:00", end: "17:00" }),
    ];
    const snapshot = JSON.parse(JSON.stringify(records));
    const periods = unavailablePeriodsFromRecords(records);
    expect(periods.map((period) => period.id)).toEqual(["first", "second"]);
    expect(periods[0]).not.toBe(records[0]);
    expect(records).toEqual(snapshot);
  });

  it("accepts the seeded availability rows unchanged", () => {
    const periods = unavailablePeriodsFromRecords(seedLecturerAvailabilities);
    expect(periods).toHaveLength(4);
    expect(periods.map((period) => period.id)).toEqual([
      "la-A-1",
      "la-B-1",
      "la-C-1",
      "la-E-1",
    ]);
    for (const period of periods) {
      expect(DAYS).toContain(period.day);
      expect(TIME_HHMM_REGEX.test(period.start)).toBe(true);
      expect(TIME_HHMM_REGEX.test(period.end)).toBe(true);
      expect(period.start < period.end).toBe(true);
    }
    for (const row of seedLecturerAvailabilities) {
      expect(row.available).toBe(false);
    }
  });

  it("finds no saved lecturer clashing with itself, so the seed satisfies the new rule", () => {
    for (const row of seedLecturerAvailabilities) {
      const sameLecturer = seedLecturerAvailabilities
        .filter((other) => other.lecturerId === row.lecturerId && other.id !== row.id)
        .map((other) => ({ ...other }));
      const decision = decideNewUnavailablePeriod(
        { day: row.day, start: row.start, end: row.end },
        unavailablePeriodsFromRecords(sameLecturer),
      );
      expect(decision.status).not.toBe("OVERLAPS");
    }
  });
});

describe("findUnavailableConflict — the rule the validator will use", () => {
  const lecturerAPeriods = unavailablePeriodsFromRecords(
    seedLecturerAvailabilities.filter((row) => row.lecturerId === "lecturer-A"),
  );

  it("returns the period an entry overlaps", () => {
    expect(lecturerAPeriods).toHaveLength(1);
    expect(findUnavailableConflict({ day: "MON", start: "16:00", end: "17:00" }, lecturerAPeriods)).toEqual(
      lecturerAPeriods[0],
    );
    expect(
      findUnavailableConflict({ day: "MON", start: "15:00", end: "16:00" }, lecturerAPeriods),
    ).toEqual(lecturerAPeriods[0]);
    expect(
      findUnavailableConflict({ day: "MON", start: "08:00", end: "17:00" }, lecturerAPeriods),
    ).toEqual(lecturerAPeriods[0]);
  });

  it("deliberately conflicting input: a one-hour class inside the unavailable window", () => {
    const decision = findUnavailableConflict(
      { day: "MON", start: "15:30", end: "16:30" },
      lecturerAPeriods,
    );
    expect(decision?.id).toBe("la-A-1");
  });

  it("returns null for adjacent, disjoint, other-day and malformed entries", () => {
    expect(findUnavailableConflict({ day: "MON", start: "14:00", end: "15:00" }, lecturerAPeriods)).toBeNull();
    expect(findUnavailableConflict({ day: "MON", start: "08:00", end: "09:00" }, lecturerAPeriods)).toBeNull();
    expect(findUnavailableConflict({ day: "TUE", start: "15:00", end: "17:00" }, lecturerAPeriods)).toBeNull();
    expect(findUnavailableConflict({ day: "SAT", start: "15:00", end: "16:00" }, lecturerAPeriods)).toBeNull();
    expect(findUnavailableConflict({ day: "MON", start: "15:0", end: "16:00" }, lecturerAPeriods)).toBeNull();
    expect(findUnavailableConflict({ day: "MON", start: "13:00", end: "14:00" }, [])).toBeNull();
  });

  it("keeps every seeded timetable entry clear of its own lecturer's unavailable periods", () => {
    const lecturerByTeaching = new Map(seedTeachings.map((t) => [t.id, t.lecturerId]));
    const periodsByLecturer = new Map<string, StoredUnavailablePeriod[]>();
    for (const row of seedLecturerAvailabilities) {
      const existing = periodsByLecturer.get(row.lecturerId) ?? [];
      periodsByLecturer.set(row.lecturerId, [
        ...existing,
        ...unavailablePeriodsFromRecords([row]),
      ]);
    }

    let checked = 0;
    for (const entry of seedTimetableEntries) {
      const lecturerId = lecturerByTeaching.get(entry.teachingId);
      if (lecturerId === undefined) continue;
      checked += 1;
      expect(findUnavailableConflict(entry, periodsByLecturer.get(lecturerId) ?? [])).toBeNull();
    }
    expect(checked).toBe(seedTimetableEntries.length);
  });
});
