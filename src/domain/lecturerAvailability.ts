import { z } from "zod";
import {
  DaySchema,
  TIME_HHMM_REGEX,
  TimeHHMMSchema,
  isStartBeforeEnd,
  type Day,
} from "./types";

/**
 * Lecturer availability rules for Kisii University TAMS (PROTOTYPE_SPEC §6, §7 hard
 * constraints, task M2-T3). Pure domain logic: no database, network, Next.js, or clock.
 *
 * A `LecturerAvailability` row records a period when a lecturer CANNOT teach, so every
 * row written here carries `available: false` — the same meaning as all four seeded rows.
 * Positive availability windows are deliberately not modelled (DECISIONS.md, M2-T3a):
 * a row with `available: true` restricts nothing and is dropped by
 * `unavailablePeriodsFromRecords()`.
 *
 * ASSUMPTION-9: the MON-FRI day set comes from the assumed slot grid (PROTOTYPE_SPEC §7).
 * Times are not limited to 08:00-17:00 here — "outside allowed slots" is the validator's rule.
 */

/** A period a lecturer cannot teach in, as entered on the form. */
export type UnavailablePeriod = { day: Day; start: string; end: string };

/** The same period as stored, so a rejection can name the existing row. */
export type StoredUnavailablePeriod = UnavailablePeriod & { id: string };

/** A `LecturerAvailability` row as far as these rules are concerned (day/times still untrusted strings). */
export type AvailabilityRecord = {
  id: string;
  day: string;
  start: string;
  end: string;
  available: boolean;
};

export type PeriodErrorField = "period" | "day" | "start" | "end";
export type PeriodErrors = Partial<Record<PeriodErrorField, string>>;

export type PeriodDecision =
  | { status: "ALLOW"; period: UnavailablePeriod }
  | { status: "INVALID"; errors: PeriodErrors }
  | { status: "DUPLICATE"; conflictingPeriod: StoredUnavailablePeriod }
  | { status: "OVERLAPS"; conflictingPeriod: StoredUnavailablePeriod };

export const PERIOD_REQUIRED_ERROR =
  "Day, start time and end time are all required";
export const PERIOD_DAY_ERROR = "Choose a weekday: MON, TUE, WED, THU or FRI";
export const PERIOD_TIME_ERROR =
  "Enter a valid 24-hour time as HH:MM, for example 13:00";
export const PERIOD_ORDER_ERROR = "Start must be earlier than end";

function isValidTime(value: string): boolean {
  return TIME_HHMM_REGEX.test(value);
}

const UnavailablePeriodInputSchema = z
  .object({
    day: DaySchema,
    start: TimeHHMMSchema,
    end: TimeHHMMSchema,
  })
  .refine((period) => {
    // A malformed time already carries its own message; only a well-formed pair can be compared.
    if (!isValidTime(period.start) || !isValidTime(period.end)) return true;
    return isStartBeforeEnd(period.start, period.end);
  }, {
    message: PERIOD_ORDER_ERROR,
    path: ["end"],
  });

/**
 * Validate untrusted input for one unavailable period. Never throws; non-object input
 * (null, arrays, strings) is reported as a whole-form problem instead of a field problem.
 */
export function parseUnavailablePeriod(
  raw: unknown,
): { ok: true; period: UnavailablePeriod } | { ok: false; errors: PeriodErrors } {
  const parsed = UnavailablePeriodInputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, period: parsed.data };
  }

  const source: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const errors: PeriodErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    const field: PeriodErrorField | undefined =
      issue.path.length === 0
        ? "period"
        : key === "day"
          ? "day"
          : key === "start"
            ? "start"
            : key === "end"
              ? "end"
              : undefined;

    if (field === "day") {
      errors.day =
        typeof source.day === "string" ? PERIOD_DAY_ERROR : PERIOD_REQUIRED_ERROR;
    } else if (field === "start" || field === "end") {
      errors[field] =
        issue.code === "custom"
          ? PERIOD_ORDER_ERROR
          : typeof source[field] === "string"
            ? PERIOD_TIME_ERROR
            : PERIOD_REQUIRED_ERROR;
    } else {
      errors.period = PERIOD_REQUIRED_ERROR;
    }
  }

  return { ok: false, errors };
}

/**
 * True when two HH:MM ranges share at least one minute (half-open: `[start, end)`).
 * Touching ranges such as 13:00-14:00 and 14:00-15:00 do NOT overlap.
 * Both ranges must be well-formed and have a positive duration, so a malformed, reversed
 * or empty range never overlaps anything — unvalidated rows cannot create a false conflict.
 */
export function timesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  if (!isStartBeforeEnd(startA, endA) || !isStartBeforeEnd(startB, endB)) {
    return false;
  }
  return startA < endB && startB < endA;
}

/** True when both periods are on the same day and their times overlap. */
export function periodsOverlap(
  a: UnavailablePeriod,
  b: UnavailablePeriod,
): boolean {
  return a.day === b.day && timesOverlap(a.start, a.end, b.start, b.end);
}

/**
 * Decide whether a lecturer may save a new unavailable period next to the periods they
 * already have. Duplicate and overlapping periods are rejected; adjacent periods are allowed.
 * The `existing` list is only read, never mutated or reordered.
 */
export function decideNewUnavailablePeriod(
  raw: unknown,
  existing: readonly StoredUnavailablePeriod[],
): PeriodDecision {
  const parsed = parseUnavailablePeriod(raw);
  if (!parsed.ok) {
    return { status: "INVALID", errors: parsed.errors };
  }

  const period = parsed.period;
  for (const item of existing) {
    if (
      item.day === period.day &&
      item.start === period.start &&
      item.end === period.end
    ) {
      return { status: "DUPLICATE", conflictingPeriod: item };
    }
    if (periodsOverlap(period, item)) {
      return { status: "OVERLAPS", conflictingPeriod: item };
    }
  }

  return { status: "ALLOW", period };
}

/**
 * Convert stored rows into the periods the rules and the future validator need:
 * rows that mean "cannot teach" (`available: false`) with a usable day and time range.
 * Rows with `available: true`, an unknown day, a malformed time, or a start that is not
 * before the end carry no usable restriction and are skipped. Input order is preserved.
 */
export function unavailablePeriodsFromRecords(
  records: readonly AvailabilityRecord[],
): StoredUnavailablePeriod[] {
  const periods: StoredUnavailablePeriod[] = [];
  for (const record of records) {
    if (record.available !== false) continue;
    if (!isValidTime(record.start) || !isValidTime(record.end)) continue;
    if (!isStartBeforeEnd(record.start, record.end)) continue;
    const day = DaySchema.safeParse(record.day);
    if (!day.success) continue;
    periods.push({ id: record.id, day: day.data, start: record.start, end: record.end });
  }
  return periods;
}

/**
 * The availability rule behind the future `LECTURER_UNAVAILABLE` violation (M3-T1):
 * the first saved period that a timetable entry overlaps, or null when the entry is free.
 * An entry outside MON-FRI, with malformed times, or with a reversed or zero-length range
 * cannot match any period.
 */
export function findUnavailableConflict(
  entry: { day: string; start: string; end: string },
  periods: readonly StoredUnavailablePeriod[],
): StoredUnavailablePeriod | null {
  for (const period of periods) {
    if (period.day !== entry.day) continue;
    if (timesOverlap(period.start, period.end, entry.start, entry.end)) {
      return period;
    }
  }
  return null;
}
