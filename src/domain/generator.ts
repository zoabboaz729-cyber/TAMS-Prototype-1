/**
 * Deterministic timetable generator for TAMS (PROTOTYPE_SPEC §7, task M4-T1).
 *
 * `generateTimetable(input, policy)` expands each teaching assignment into the
 * sessions its `sessionsPerWeek` and `sessionLength` require, orders those
 * sessions by scheduling difficulty, and gives each one a day, an hourly grid
 * slot and a venue by bounded backtracking. It is pure domain logic: no
 * database, no network, no Next.js and no clock — every fact comes from
 * `input`, so the same input and policy always produce the same output.
 *
 * What a clash IS is never redefined here. The search applies the accepted M3
 * validator's own primitives (`checkSlot`, `timesOverlap`,
 * `findUnavailableConflict`, and the same capacity and venue-type
 * comparisons), and the finished timetable is handed back to
 * `validateEntries` before it is returned: any generated row the validator
 * flags is removed and reported, never left in the result looking clean.
 *
 * The M4-T2 caller keeps its locked rows by passing them as `fixedEntries`.
 * Those rows are put on the board before the search, are never moved, and
 * count towards the sessions their teaching already has, so an existing draft
 * row is never scheduled a second time.
 */

import {
  validateEntries,
  type EntryInput,
  type MissingContextError,
  type TeachingInfo,
  type ValidationContext,
  type VenueInfo,
} from "./validator";
import {
  unavailablePeriodsFromRecords,
  type StoredUnavailablePeriod,
} from "./lecturerAvailability";
import type { PolicyConfig } from "./policy";
import {
  buildSlotGrid,
  orderActivities,
  runSearch,
  SearchState,
  type Activity,
  type ActivityFailure,
  type SearchContext,
  type Slot,
} from "./generatorSearch";

/** Candidate slots examined per pass — the prototype default search bound. */
export const DEFAULT_STEP_LIMIT = 20_000;
/** Guards against corrupt `sessionsPerWeek` / `sessionLength` values. */
const MAX_SESSIONS_PER_WEEK = 12;
const MAX_SESSION_HOURS = 6;
const MAX_REPAIR_ROUNDS = 10;

export type GeneratorTeaching = {
  id: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  /** HALL | ROOM | LAB, as `Unit.venueTypeRequired`. */
  venueTypeRequired: string;
  /** Unit code, for the plain-language messages. */
  unitCode: string;
  sessionsPerWeek: number;
  /** Contact hours per session. */
  sessionLength: number;
};

export type GeneratorVenue = { id: string; code: string; type: string; capacity: number };

/** One unavailable period — a lecturer's or a venue's, same meaning as M2-T3a. */
export type GeneratorPeriod = { day: string; start: string; end: string };

export type GeneratorInput = {
  teachings: readonly GeneratorTeaching[];
  venues: readonly GeneratorVenue[];
  /** Lecturer unavailable periods keyed by lecturerId. */
  lecturerUnavailable?: Record<string, readonly GeneratorPeriod[]>;
  /** Venue unavailable periods keyed by venueId. */
  venueUnavailable?: Record<string, readonly GeneratorPeriod[]>;
  /** Locked rows to keep exactly as they are (M4-T2 passes the draft's locked entries). */
  fixedEntries?: readonly EntryInput[];
  stepLimit?: number;
};

/** A required session that could not be placed. */
export type UnplacedActivity = {
  kind: "ACTIVITY";
  /** `gen-<teachingId>-<session number>` — stable for the same input. */
  activityId: string;
  teachingId: string;
  unitCode: string;
  reason: ActivityFailure;
  message: string;
};

/** An input row that could not be kept, reported instead of dropped. */
export type UnplacedFixed = {
  kind: "FIXED";
  entryId: string;
  teachingId: string;
  reason: "FIXED_UNRESOLVED" | "FIXED_CONFLICT";
  message: string;
};

export type GenerateResult = {
  entries: EntryInput[];
  unplaced: (UnplacedActivity | UnplacedFixed)[];
  /** Soft-constraint penalty points; 0 is ideal and lower is better. */
  softScore: number;
};

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function intInRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** First row wins per id: a repeated id cannot be scheduled or counted twice. */
function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return map;
}

function periodsByResource(
  records: Record<string, readonly GeneratorPeriod[]> | undefined,
): Map<string, GeneratorPeriod[]> {
  const map = new Map<string, GeneratorPeriod[]>();
  if (!records) return map;
  for (const key of Object.keys(records)) {
    const periods = records[key];
    if (!Array.isArray(periods)) continue;
    map.set(
      key,
      periods.filter(
        (period) =>
          period !== null &&
          typeof period.day === "string" &&
          typeof period.start === "string" &&
          typeof period.end === "string",
      ),
    );
  }
  return map;
}

/**
 * Lecturer periods go through the accepted availability interpretation
 * (`unavailablePeriodsFromRecords`) so the generator and the validator read the
 * same rows the same way: an unknown day, a malformed time or a range that does
 * not move forward restricts nothing.
 */
function lecturerPeriodsByLecturer(
  periods: Map<string, GeneratorPeriod[]>,
): Map<string, StoredUnavailablePeriod[]> {
  const map = new Map<string, StoredUnavailablePeriod[]>();
  for (const [lecturerId, list] of periods) {
    map.set(
      lecturerId,
      unavailablePeriodsFromRecords(
        list.map((period, index) => ({
          id: `${lecturerId}|${index}|${period.start}-${period.end}`,
          day: period.day,
          start: period.start,
          end: period.end,
          available: false,
        })),
      ),
    );
  }
  return map;
}

/** The unavailability data the M3-T1 validator needs, built from the same maps the search used. */
function validationContext(
  teachings: Map<string, GeneratorTeaching>,
  venues: Map<string, GeneratorVenue>,
  lecturerPeriods: Map<string, StoredUnavailablePeriod[]>,
  venuePeriods: Map<string, GeneratorPeriod[]>,
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
// Activities
// ---------------------------------------------------------------------------

/**
 * Each teaching owes `sessionsPerWeek` sessions of `sessionLength` hours.
 * Fixed rows already on the board satisfy part of that debt, so only the
 * remainder becomes an activity — an existing draft row is never scheduled
 * twice. Extra fixed rows beyond the weekly requirement are kept, not removed.
 */
function expandActivities(
  teachings: ReadonlyMap<string, GeneratorTeaching>,
  fixedSessionsByTeaching: ReadonlyMap<string, number>,
): Activity[] {
  const activities: Activity[] = [];
  for (const teaching of teachings.values()) {
    const sessionsPerWeek = intInRange(teaching.sessionsPerWeek, 0, MAX_SESSIONS_PER_WEEK);
    const durationMinutes = intInRange(teaching.sessionLength, 1, MAX_SESSION_HOURS) * 60;
    const already = fixedSessionsByTeaching.get(teaching.id) ?? 0;
    const remaining = Math.max(0, sessionsPerWeek - already);
    for (let index = 1; index <= remaining; index++) {
      activities.push({
        id: `gen-${teaching.id}-${index}`,
        teachingId: teaching.id,
        index,
        unitCode: typeof teaching.unitCode === "string" ? teaching.unitCode : teaching.id,
        lecturerId: teaching.lecturerId,
        groupId: teaching.groupId,
        expectedSize: teaching.expectedSize,
        venueTypeRequired: teaching.venueTypeRequired,
        durationMinutes,
      });
    }
  }
  return activities;
}

// ---------------------------------------------------------------------------
// Self-check against the accepted validator
// ---------------------------------------------------------------------------

type Reconciled = {
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
function reconcile(
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

function teachingIdOf(entries: readonly EntryInput[], entryId: string): string {
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

function getOrSet<K, V>(map: Map<K, V>, key: K, build: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = build();
  map.set(key, created);
  return created;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function sortByWeek(entries: readonly EntryInput[], policy: PolicyConfig): EntryInput[] {
  const dayIndex = new Map(policy.days.map((day, index) => [day, index] as const));
  const rank = (entry: EntryInput): number => dayIndex.get(entry.day) ?? Number.MAX_SAFE_INTEGER;
  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || compareText(a.start, b.start) || compareText(a.id, b.id),
  );
}

function compareUnplaced(
  a: UnplacedActivity | UnplacedFixed,
  b: UnplacedActivity | UnplacedFixed,
): number {
  if (a.kind !== b.kind) return a.kind === "FIXED" ? -1 : 1;
  return compareText(a.kind === "FIXED" ? a.entryId : a.activityId, b.kind === "FIXED" ? b.entryId : b.activityId);
}

export function generateTimetable(input: GeneratorInput, policy: PolicyConfig): GenerateResult {
  const teachings = indexById(input.teachings ?? []);
  const venues = indexById(input.venues ?? []);
  const lecturerPeriods = lecturerPeriodsByLecturer(periodsByResource(input.lecturerUnavailable));
  const venuePeriods = periodsByResource(input.venueUnavailable);
  const stepLimit = intInRange(input.stepLimit ?? DEFAULT_STEP_LIMIT, 0, Number.MAX_SAFE_INTEGER);

  const fixedRows: EntryInput[] = [];
  const fixedIds = new Set<string>();
  const fixedSessions = new Map<string, number>();
  const unplaced: (UnplacedActivity | UnplacedFixed)[] = [];

  for (const entry of input.fixedEntries ?? []) {
    const teaching = teachings.get(entry.teachingId);
    const venue = venues.get(entry.venueId);
    if (!teaching || !venue) {
      unplaced.push({
        kind: "FIXED",
        entryId: entry.id,
        teachingId: entry.teachingId,
        reason: "FIXED_UNRESOLVED",
        message: `Entry ${entry.id} refers to ${
          teaching ? `venue "${entry.venueId}"` : `teaching "${entry.teachingId}"`
        }, which is not part of this input, so it could not be kept or checked.`,
      });
      continue;
    }
    fixedRows.push({
      id: entry.id,
      teachingId: entry.teachingId,
      venueId: entry.venueId,
      day: entry.day,
      start: entry.start,
      end: entry.end,
    });
    fixedIds.add(entry.id);
    fixedSessions.set(entry.teachingId, (fixedSessions.get(entry.teachingId) ?? 0) + 1);
  }

  const activities = expandActivities(teachings, fixedSessions);
  const slotGrids = new Map<number, Slot[]>();
  for (const activity of activities) {
    if (!slotGrids.has(activity.durationMinutes)) {
      slotGrids.set(activity.durationMinutes, buildSlotGrid(policy, activity.durationMinutes));
    }
  }

  const createState = (): SearchState => {
    const state = new SearchState();
    for (const entry of fixedRows) {
      const teaching = teachings.get(entry.teachingId);
      if (!teaching) continue;
      state.preplace({
        venueId: entry.venueId,
        lecturerId: teaching.lecturerId,
        groupId: teaching.groupId,
        day: entry.day,
        start: entry.start,
        end: entry.end,
      });
    }
    return state;
  };

  const searchPass = (enforceLoadLimits: boolean): SearchContext => ({
    slotGrids,
    venues,
    lecturerPeriods,
    venuePeriods,
    policy,
    enforceLoadLimits,
    stepLimit,
  });

  // Pass 1 keeps the ASSUMPTION-10 day limits. If that leaves a session with
  // nowhere to go, pass 2 relaxes only those limits so no session is dropped
  // for a reason the M3 validator does not treat as hard. Pass 1 is kept unless
  // relaxing genuinely buys more placed sessions, so a draft is never spread
  // over more days than it needs to be.
  const strictContext = searchPass(true);
  const strict = runSearch(orderActivities(activities, strictContext), strictContext, createState);
  let outcome = strict;
  if (strict.unplaced.length > 0) {
    const relaxedContext = searchPass(false);
    const second = runSearch(orderActivities(activities, relaxedContext), relaxedContext, createState);
    if (second.placed.length > strict.placed.length) outcome = second;
  }

  const board = [...fixedRows, ...outcome.placed.map((item) => item.entry)];
  const context = validationContext(teachings, venues, lecturerPeriods, venuePeriods);
  const kept = reconcile(board, fixedIds, context, policy);
  const activityById = new Map(outcome.placed.map((item) => [item.entry.id, item.activity] as const));

  const entries = sortByWeek([...fixedRows, ...kept.entries], policy);

  for (const item of outcome.unplaced) {
    unplaced.push({
      kind: "ACTIVITY",
      activityId: item.activity.id,
      teachingId: item.activity.teachingId,
      unitCode: item.activity.unitCode,
      reason: item.reason,
      message: item.message,
    });
  }

  // Only reachable if the search and the validator ever disagreed; the shared
  // primitives make that impossible today, but the row is still reported.
  for (const item of kept.rejected) {
    const activity = activityById.get(item.entryId);
    const fallback = teachingIdOf(board, item.entryId);
    unplaced.push({
      kind: "ACTIVITY",
      activityId: item.entryId,
      teachingId: activity?.teachingId ?? fallback,
      unitCode: activity?.unitCode ?? fallback,
      reason: "NO_FREE_SLOT",
      message: activity
        ? `Session ${activity.index} of ${activity.unitCode} was placed but the validator rejected it: ${item.message}`
        : `Entry ${item.entryId} was rejected by the validator: ${item.message}`,
    });
  }

  // `unresolved` can only name a fixed row: every generated row is built from a
  // teaching and venue that this same input carries.
  unplaced.push(...kept.fixedConflicts, ...kept.unresolved);
  unplaced.sort(compareUnplaced);

  return {
    entries,
    unplaced,
    softScore: softPenalty(toRows(entries, context), policy),
  };
}
