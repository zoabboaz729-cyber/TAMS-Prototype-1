/**
 * Conflict validator for TAMS timetable entries (PROTOTYPE_SPEC §7, task M3-T1).
 *
 * Pure domain logic: no database, network, Next.js, or clock. All inputs are
 * passed in — the caller (M3-T2 draft editor or M4 generator) resolves
 * teaching, venue, and unavailability data from the database and builds the
 * {@link ValidationContext}.
 *
 * Reuses {@link timesOverlap} and {@link findUnavailableConflict} from
 * lecturerAvailability.ts so the half-open range semantics are shared.
 *
 * Hard constraints checked (PROTOTYPE_SPEC §7):
 *   VENUE_OVERLAP, LECTURER_OVERLAP, GROUP_OVERLAP — pairwise, same day +
 *   overlapping times.
 *   CAPACITY — venue capacity < teaching expectedSize.
 *   VENUE_TYPE — venue type ≠ unit venueTypeRequired.
 *   LECTURER_UNAVAILABLE — entry overlaps a lecturer's stored unavailable period.
 *   VENUE_UNAVAILABLE — entry overlaps a venue's stored unavailable period.
 *   OUT_OF_SLOT — day outside Mon–Fri, time outside 08:00–17:00, or overlaps
 *   the 13:00–14:00 lunch break.
 *
 * The load limits in PolicyConfig (maxHoursPerLecturerPerDay,
 * maxClassesPerGroupPerDay) are not checked here — they are soft constraints
 * scored by the M4 generator, not hard violations.
 *
 * Facility matching is not checked — the domain model has no per-unit
 * required-facilities field (ASSUMPTION-18 maps to venueTypeRequired only).
 *
 * Missing teaching or venue context is a data-integrity failure, not a
 * scheduling violation: validateEntries() returns an "incomplete" outcome
 * naming every entry whose context is missing, so a caller can never read an
 * empty violations list as "conflict-free" when the check could not finish.
 */

import {
  timesOverlap,
  findUnavailableConflict,
  type StoredUnavailablePeriod,
} from "./lecturerAvailability";
import { TIME_HHMM_REGEX, isStartBeforeEnd } from "./types";
import type { PolicyConfig } from "./policy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViolationType =
  | "VENUE_OVERLAP"
  | "LECTURER_OVERLAP"
  | "GROUP_OVERLAP"
  | "CAPACITY"
  | "VENUE_TYPE"
  | "LECTURER_UNAVAILABLE"
  | "VENUE_UNAVAILABLE"
  | "OUT_OF_SLOT";

export type Violation = {
  type: ViolationType;
  /** The entry that has the problem. */
  entryId: string;
  /** Plain-language description for inline display (M3-T2). */
  message: string;
  /** For pairwise violations, the conflicting entry's id. */
  conflictEntryId?: string;
};

/** A timetable entry as the validator sees it. */
export type EntryInput = {
  id: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
};

/** Teaching info resolved from the database, keyed by teachingId. */
export type TeachingInfo = {
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  /** Venue type required by the unit (HALL | ROOM | LAB). */
  venueTypeRequired: string;
  /** Unit code for human-readable messages. */
  unitCode: string;
};

/** Venue info resolved from the database, keyed by venueId. */
export type VenueInfo = {
  capacity: number;
  type: string;
  /** Venue code for human-readable messages. */
  code: string;
};

/** A venue unavailability period. */
export type VenueUnavailablePeriod = {
  day: string;
  start: string;
  end: string;
  reason?: string;
};

export type ValidationContext = {
  teachings: Record<string, TeachingInfo>;
  venues: Record<string, VenueInfo>;
  /** Lecturer unavailable periods keyed by lecturerId. */
  lecturerUnavailable: Record<string, StoredUnavailablePeriod[]>;
  /** Venue unavailable periods keyed by venueId. */
  venueUnavailable: Record<string, VenueUnavailablePeriod[]>;
};

/**
 * Data-integrity failure: an entry references a teaching or venue that the
 * context does not carry, so the checks that need it could not run. Kept
 * separate from Violation (a scheduling constraint breach) on purpose.
 */
export type MissingContextError = {
  kind: "MISSING_TEACHING" | "MISSING_VENUE";
  /** Position of the affected entry in the entries array. */
  entryIndex: number;
  /** The entry's id, for display. */
  entryId: string;
  /** The teachingId or venueId the context could not resolve. */
  refId: string;
  message: string;
};

/**
 * Discriminated outcome of validateEntries(). A caller must switch on
 * `status`: only "ok" means the entries are conflict-free when
 * `violations.length === 0`; "incomplete" means the validation could not
 * finish and its violations must be treated as provisional.
 */
export type ValidationOutcome =
  | { status: "ok"; violations: Violation[] }
  | { status: "incomplete"; violations: Violation[]; missingContext: MissingContextError[] };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Context lookups must see own keys only: an entry whose teachingId or venueId
 * is e.g. "__proto__" would otherwise resolve through the Object prototype and
 * be counted as having complete context.
 */
function resolve<T>(lookup: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(lookup, key) ? lookup[key] : undefined;
}

/**
 * Check whether an entry falls inside the policy slot grid.
 * Returns the first OUT_OF_SLOT violation found, or null.
 * Day, time-format, ordering, slot-window, and lunch-break are checked in
 * that order so the message identifies the most fundamental problem first.
 */
function checkSlot(
  entry: EntryInput,
  policy: PolicyConfig,
): Violation | null {
  if (!policy.days.includes(entry.day)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `${entry.day} is not a teaching day. Teaching days are ${policy.days.join(", ")}.`,
    };
  }

  if (!TIME_HHMM_REGEX.test(entry.start) || !TIME_HHMM_REGEX.test(entry.end)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: "Time must be a valid 24-hour HH:MM value.",
    };
  }

  if (!isStartBeforeEnd(entry.start, entry.end)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: "Start time must be earlier than end time.",
    };
  }

  if (entry.start < policy.slotStart) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class starts at ${entry.start} but the earliest slot is ${policy.slotStart}.`,
    };
  }

  if (entry.end > policy.slotEnd) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class ends at ${entry.end} but the latest slot is ${policy.slotEnd}.`,
    };
  }

  if (timesOverlap(entry.start, entry.end, policy.lunchStart, policy.lunchEnd)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class overlaps the lunch break (${policy.lunchStart}-${policy.lunchEnd}).`,
    };
  }

  return null;
}

/**
 * Validate a list of timetable entries against all hard constraints.
 *
 * Per-entry checks (OUT_OF_SLOT, CAPACITY, VENUE_TYPE, LECTURER_UNAVAILABLE,
 * VENUE_UNAVAILABLE) run first in entry order. Pairwise checks (VENUE_OVERLAP,
 * LECTURER_OVERLAP, GROUP_OVERLAP) run afterward, comparing each entry with
 * every later entry (i < j) so each conflict is reported once.
 *
 * Entries whose teachingId or venueId is not found in the context skip the
 * checks that need the missing data — they never crash — and are named in
 * `missingContext`, which makes the outcome "incomplete" rather than "ok".
 *
 * The result is deterministic for the same input.
 */
export function validateEntries(
  entries: readonly EntryInput[],
  context: ValidationContext,
  policy: PolicyConfig,
): ValidationOutcome {
  const violations: Violation[] = [];
  const missingContext: MissingContextError[] = [];

  // --- Per-entry checks -----------------------------------------------------

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const teaching = resolve(context.teachings, entry.teachingId);
    const venue = resolve(context.venues, entry.venueId);

    if (!teaching) {
      missingContext.push({
        kind: "MISSING_TEACHING",
        entryIndex: index,
        entryId: entry.id,
        refId: entry.teachingId,
        message: `Entry ${entry.id} refers to teaching "${entry.teachingId}", which is missing from the validation context.`,
      });
    }
    if (!venue) {
      missingContext.push({
        kind: "MISSING_VENUE",
        entryIndex: index,
        entryId: entry.id,
        refId: entry.venueId,
        message: `Entry ${entry.id} refers to venue "${entry.venueId}", which is missing from the validation context.`,
      });
    }

    const slot = checkSlot(entry, policy);
    if (slot) violations.push(slot);

    if (teaching && venue) {
      if (venue.capacity < teaching.expectedSize) {
        violations.push({
          type: "CAPACITY",
          entryId: entry.id,
          message: `${venue.code} holds ${venue.capacity} students but ${teaching.unitCode} expects ${teaching.expectedSize}.`,
        });
      }

      if (venue.type !== teaching.venueTypeRequired) {
        violations.push({
          type: "VENUE_TYPE",
          entryId: entry.id,
          message: `${venue.code} is a ${venue.type} but ${teaching.unitCode} requires a ${teaching.venueTypeRequired}.`,
        });
      }
    }

    if (teaching) {
      const periods = resolve(context.lecturerUnavailable, teaching.lecturerId) ?? [];
      const conflict = findUnavailableConflict(entry, periods);
      if (conflict) {
        violations.push({
          type: "LECTURER_UNAVAILABLE",
          entryId: entry.id,
          message: `Lecturer is unavailable ${conflict.day} ${conflict.start}-${conflict.end}.`,
        });
      }
    }

    if (venue) {
      const periods = resolve(context.venueUnavailable, entry.venueId) ?? [];
      for (const period of periods) {
        if (
          period.day === entry.day &&
          timesOverlap(entry.start, entry.end, period.start, period.end)
        ) {
          violations.push({
            type: "VENUE_UNAVAILABLE",
            entryId: entry.id,
            message: `${venue.code} is unavailable ${period.day} ${period.start}-${period.end}.`,
          });
          break;
        }
      }
    }
  }

  // --- Pairwise checks -------------------------------------------------------

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      if (a.day !== b.day) continue;
      if (!timesOverlap(a.start, a.end, b.start, b.end)) continue;

      const ta = resolve(context.teachings, a.teachingId);
      const tb = resolve(context.teachings, b.teachingId);
      const va = resolve(context.venues, a.venueId);

      if (a.venueId === b.venueId) {
        violations.push({
          type: "VENUE_OVERLAP",
          entryId: a.id,
          conflictEntryId: b.id,
          message: `${va?.code ?? a.venueId} is used by two classes at the same time (${a.day} ${a.start}-${a.end}).`,
        });
      }

      if (ta && tb && ta.lecturerId === tb.lecturerId) {
        violations.push({
          type: "LECTURER_OVERLAP",
          entryId: a.id,
          conflictEntryId: b.id,
          message: `Lecturer teaches two classes at the same time (${a.day} ${a.start}-${a.end}).`,
        });
      }

      if (ta && tb && ta.groupId === tb.groupId) {
        violations.push({
          type: "GROUP_OVERLAP",
          entryId: a.id,
          conflictEntryId: b.id,
          message: `Group has two classes at the same time (${a.day} ${a.start}-${a.end}).`,
        });
      }
    }
  }

  if (missingContext.length > 0) {
    return { status: "incomplete", violations, missingContext };
  }
  return { status: "ok", violations };
}
