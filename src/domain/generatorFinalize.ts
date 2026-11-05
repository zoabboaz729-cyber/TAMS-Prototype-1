/**
 * Final-board reconciliation and soft scoring for the TAMS timetable
 * generator (task M4-T1c; extracted from `generator.ts` on the M3-T1b
 * `slotValidation.ts` pattern).
 *
 * Pure domain logic: no database, network, Next.js, or clock. Two jobs live
 * here, both about the finished board rather than the search:
 *
 * 1. Reconciliation — the assembled timetable is handed to the accepted M3
 *    `validateEntries` and its verdict is applied: a generated row it flags
 *    comes off the board and is reported; a locked row it flags stays put
 *    (the generator must not move it) and is reported for the officer to
 *    resolve. What a clash IS is defined only by that validator — nothing
 *    here adds or redefines a hard constraint.
 * 2. Soft scoring — the penalty total for the PROTOTYPE_SPEC §7 soft
 *    constraints over the final entries, unchanged from M4-T1 decision (h).
 *
 * Imports from `./generator` are type-only (erased at compile time), so the
 * runtime dependency graph stays one-way: generator → generatorFinalize,
 * mirroring the generator → generatorSearch arrangement.
 */

import {
  validateEntries,
  type EntryInput,
  type MissingContextError,
  type TeachingInfo,
  type ValidationContext,
  type VenueInfo,
} from "./validator";
import type { StoredUnavailablePeriod } from "./lecturerAvailability";
import type { PolicyConfig } from "./policy";
import type { GeneratorPeriod, GeneratorTeaching, GeneratorVenue, UnplacedFixed } from "./generator";

/** Guards a pathological repair loop; a well-behaved board converges in one round. */
const MAX_REPAIR_ROUNDS = 10;

/** The M3-T1 validator's shape, built from the generator's own lookups. */
export function validationContext(
  teachings: ReadonlyMap<string, GeneratorTeaching>,
  venues: ReadonlyMap<string, GeneratorVenue>,
  lecturerPeriods: ReadonlyMap<string, StoredUnavailablePeriod[]>,
  venuePeriods: ReadonlyMap<string, GeneratorPeriod[]>,
): ValidationContext {
  const teachingEntries: [string, TeachingInfo][] = [...teachings.values()].map((teaching) => [
    teaching.id,
    {
      lecturerId: teaching.lecturerId,
      groupId: teaching.groupId,
      expectedSize: teaching.expectedSize,
      venueTypeRequired: teaching.venueTypeRequired,
      unitCode: teaching.unitCode,
    },
  ]);
  const venueEntries: [string, VenueInfo][] = [...venues.values()].map((venue) => [
    venue.id,
    { capacity: venue.capacity, type: venue.type, code: venue.code },
  ]);
  return {
    // Object.fromEntries creates own properties, so an id like "__proto__"
    // cannot resolve through the Object prototype.
    teachings: Object.fromEntries(teachingEntries),
    venues: Object.fromEntries(venueEntries),
    lecturerUnavailable: Object.fromEntries(lecturerPeriods),
    venueUnavailable: Object.fromEntries(venuePeriods),
  };
}

// ---------------------------------------------------------------------------
// Self-check against the accepted validator
// ---------------------------------------------------------------------------

export type Reconciled = {
  /** Generated rows the validator accepted, in board order. */
  entries: EntryInput[];
  /** Generated rows the validator rejected, with its own message. */
  rejected: { entryId: string; message: string }[];
  fixedConflicts: UnplacedFixed[];
  unresolved: UnplacedFixed[];
};

/**
 * Validate the finished board with `validateEntries` and act on what it says.
 * A generated row it flags is taken back off the board and reported; a locked
 * row it flags stays put (the generator must not move it) and is reported as a
 * conflict the officer has to resolve. Normally nothing is flagged — this is
 * what guarantees the generator and the validator never disagree.
 */
export function reconcile(
  entries: readonly EntryInput[],
  fixedIds: ReadonlySet<string>,
  context: ValidationContext,
  policy: PolicyConfig,
): Reconciled {
  const rejected: { entryId: string; message: string }[] = [];
  const unresolved: UnplacedFixed[] = [];
  const conflicts = new Map<string, UnplacedFixed>();
  let remaining = [...entries];

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    const outcome = validateEntries(remaining, context, policy);
    const missing = new Map<string, MissingContextError>();
    if (outcome.status === "incomplete") {
      for (const error of outcome.missingContext) missing.set(error.entryId, error);
    }

    const rejectedNow = new Map<string, string>();
    for (const violation of outcome.violations) {
      if (fixedIds.has(violation.entryId)) {
        const key = `${violation.type}|${violation.entryId}|${violation.conflictEntryId ?? ""}`;
        if (!conflicts.has(key)) {
          conflicts.set(key, {
            kind: "FIXED",
            entryId: violation.entryId,
            teachingId: teachingIdOf(remaining, violation.entryId),
            reason: "FIXED_CONFLICT",
            message: `Locked entry ${violation.entryId} cannot move: ${violation.message}`,
          });
        }
        continue;
      }
      if (!missing.has(violation.entryId) && !rejectedNow.has(violation.entryId)) {
        rejectedNow.set(violation.entryId, violation.message);
      }
    }

    if (missing.size === 0 && rejectedNow.size === 0) break;

    const remove = new Set<string>([...missing.keys(), ...rejectedNow.keys()]);
    for (const [entryId, message] of rejectedNow) rejected.push({ entryId, message });
    for (const error of missing.values()) {
      unresolved.push({
        kind: "FIXED",
        entryId: error.entryId,
        teachingId: teachingIdOf(remaining, error.entryId),
        reason: "FIXED_UNRESOLVED",
        message: error.message,
      });
    }
    remaining = remaining.filter((entry) => !remove.has(entry.id));
  }

  return {
    entries: remaining.filter((entry) => !fixedIds.has(entry.id)),
    rejected,
    fixedConflicts: [...conflicts.values()],
    unresolved,
  };
}

export function teachingIdOf(entries: readonly EntryInput[], entryId: string): string {
  return entries.find((entry) => entry.id === entryId)?.teachingId ?? entryId;
}

// ---------------------------------------------------------------------------
// Soft scoring
// ---------------------------------------------------------------------------

type TimetableRow = {
  entryId: string;
  lecturerId: string;
  groupId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
};

function hourAnchor(time: string): number {
  return Math.floor(minutesOf(time) / 60) * 60;
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function minutesBetween(start: string, end: string): number {
  return minutesOf(end) - minutesOf(start);
}

/**
 * Length of a row in minutes, or NaN when either bound is malformed — a NaN
 * duration equals no required length, so callers can treat it as "not the
 * session it was counted against" rather than silently accepting it.
 */
export function rowDurationMinutes(start: string, end: string): number {
  return minutesBetween(start, end);
}

function toRows(entries: readonly EntryInput[], context: ValidationContext): TimetableRow[] {
  const rows: TimetableRow[] = [];
  for (const entry of entries) {
    const teaching = Object.hasOwn(context.teachings, entry.teachingId)
      ? context.teachings[entry.teachingId]
      : undefined;
    if (!teaching) continue;
    rows.push({
      entryId: entry.id,
      lecturerId: teaching.lecturerId,
      groupId: teaching.groupId,
      venueId: entry.venueId,
      day: entry.day,
      start: entry.start,
      end: entry.end,
    });
  }
  return rows;
}

/**
 * Penalty points for the PROTOTYPE_SPEC §7 soft constraints — fewer gaps per
 * group, fewer venue changes, balanced days — plus every hour the draft had to
 * breach an ASSUMPTION-10 day limit. Locked rows are counted too: they are part
 * of the draft the officer reads. Lower is better; 0 means none of these
 * penalties apply. Preferred slots are not scored because the domain model has
 * no preferred-slot field for a unit to carry.
 */
function softPenalty(rows: readonly TimetableRow[], policy: PolicyConfig): number {
  let penalty = 0;

  const lecturerDayMinutes = new Map<string, number>();
  const groupDays = new Map<string, Map<string, TimetableRow[]>>();
  for (const row of rows) {
    const days = getOrSet(groupDays, row.groupId, () => new Map<string, TimetableRow[]>());
    getOrSet(days, row.day, () => []).push(row);
    const key = `${row.lecturerId}|${row.day}`;
    lecturerDayMinutes.set(key, (lecturerDayMinutes.get(key) ?? 0) + minutesBetween(row.start, row.end));
  }

  for (const minutes of lecturerDayMinutes.values()) {
    const over = minutes / 60 - policy.maxHoursPerLecturerPerDay;
    if (over > 0) penalty += Math.ceil(over);
  }

  const lunchAnchors = new Set<number>();
  for (let anchor = hourAnchor(policy.lunchStart); anchor < hourAnchor(policy.lunchEnd); anchor += 60) {
    lunchAnchors.add(anchor);
  }

  for (const days of groupDays.values()) {
    let totalClasses = 0;
    for (const dayRows of days.values()) {
      totalClasses += dayRows.length;
      if (dayRows.length > policy.maxClassesPerGroupPerDay) {
        penalty += dayRows.length - policy.maxClassesPerGroupPerDay;
      }

      const occupied = new Set<number>();
      let first = Number.POSITIVE_INFINITY;
      let last = Number.NEGATIVE_INFINITY;
      for (const row of dayRows) {
        const from = hourAnchor(row.start);
        for (let anchor = from; anchor < hourAnchor(row.end); anchor += 60) occupied.add(anchor);
        first = Math.min(first, from);
        last = Math.max(last, hourAnchor(row.end) - 60);
      }
      for (let anchor = first; anchor <= last; anchor += 60) {
        if (!occupied.has(anchor) && !lunchAnchors.has(anchor)) penalty += 2;
      }

      const ordered = [...dayRows].sort((a, b) => compareText(a.start, b.start));
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].venueId !== ordered[i - 1].venueId) penalty += 1;
      }
    }

    const target = Math.ceil(totalClasses / Math.max(1, policy.days.length));
    for (const dayRows of days.values()) {
      if (dayRows.length > target) penalty += dayRows.length - target;
    }
  }

  return penalty;
}

/** The public scoring entry point: penalty total over the final entries. */
export function softScoreOf(
  entries: readonly EntryInput[],
  context: ValidationContext,
  policy: PolicyConfig,
): number {
  return softPenalty(toRows(entries, context), policy);
}

function getOrSet<K, V>(map: Map<K, V>, key: K, build: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = build();
  map.set(key, created);
  return created;
}

/** Total string order used by both the scorer here and the generator's sorts. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
