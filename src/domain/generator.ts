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
 * comparisons), and the finished board is handed back to `validateEntries`
 * (through `generatorFinalize.reconcile`) before it is returned: any generated
 * row the validator flags is removed and reported, never left in the result
 * looking clean. Final reconciliation and soft scoring live in
 * `generatorFinalize.ts` (M4-T1c).
 *
 * The M4-T2 caller keeps its locked rows by passing them as `fixedEntries`.
 * Those rows go on the board before the search and are never moved. A locked
 * row counts towards the sessions its teaching already has only when its
 * length equals `sessionLength`; a wrong-length row, and any row beyond the
 * weekly requirement, stays unchanged on the board and is reported as a
 * `FIXED_CONFLICT` instead of being silently counted — so an existing draft
 * row is never scheduled a second time and never stands in for a session it
 * cannot cover.
 */

import type { EntryInput } from "./validator";
import {
  unavailablePeriodsFromRecords,
  type StoredUnavailablePeriod,
} from "./lecturerAvailability";
import type { PolicyConfig } from "./policy";
import {
  compareText,
  reconcile,
  rowDurationMinutes,
  softScoreOf,
  teachingIdOf,
  validationContext,
} from "./generatorFinalize";
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

/**
 * An input row that could not be kept, or that was kept but needs the
 * officer's attention, reported instead of dropped: `FIXED_UNRESOLVED` for a
 * row whose teaching or venue is absent, and `FIXED_CONFLICT` for a row the
 * accepted validator flags, for a wrong-length row that cannot count as a
 * required session, or for an extra row beyond the weekly requirement
 * (M4-T1c). A recognised row always stays in `entries` unchanged.
 */
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

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * Each teaching owes `sessionsPerWeek` sessions of `sessionLength` hours.
 * Only the correctly sized, non-excess fixed rows the caller counted into
 * `fixedSessionsByTeaching` satisfy part of that debt, so only the remainder
 * becomes an activity — an existing draft row is never scheduled a second
 * time, and a locked row of the wrong length never stands in for a session it
 * cannot cover. Fixed rows are kept, never removed.
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

function lengthLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return "an invalid time range";
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
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
  // Correctly sized locked rows per teaching, awaiting the counted/excess split
  // below. The split is by entry id, not input order, so reordering the draft
  // reports exactly the same rows (M4-T1c).
  const sizedRows = new Map<string, EntryInput[]>();

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
    const row: EntryInput = {
      id: entry.id,
      teachingId: entry.teachingId,
      venueId: entry.venueId,
      day: entry.day,
      start: entry.start,
      end: entry.end,
    };
    fixedRows.push(row);
    fixedIds.add(row.id);
    const requiredMinutes = intInRange(teaching.sessionLength, 1, MAX_SESSION_HOURS) * 60;
    const actualMinutes = rowDurationMinutes(row.start, row.end);
    if (actualMinutes === requiredMinutes) {
      const list = sizedRows.get(teaching.id);
      if (list) list.push(row);
      else sizedRows.set(teaching.id, [row]);
    } else {
      unplaced.push({
        kind: "FIXED",
        entryId: row.id,
        teachingId: teaching.id,
        reason: "FIXED_CONFLICT",
        message: `Locked entry ${row.id} runs ${lengthLabel(actualMinutes)} but ${teaching.unitCode} sessions are ${lengthLabel(requiredMinutes)}: locked rows cannot be moved or resized, so it was kept unchanged, did not count toward the weekly sessions, and the matching session was scheduled around it. Fix its length in the draft or unlock it.`,
      });
    }
  }

  for (const [teachingId, rows] of sizedRows) {
    const teaching = teachings.get(teachingId);
    if (!teaching) continue;
    const sessionsPerWeek = intInRange(teaching.sessionsPerWeek, 0, MAX_SESSIONS_PER_WEEK);
    const ordered = [...rows].sort((a, b) => compareText(a.id, b.id));
    const counted = Math.min(sessionsPerWeek, ordered.length);
    fixedSessions.set(teachingId, counted);
    for (const extra of ordered.slice(counted)) {
      unplaced.push({
        kind: "FIXED",
        entryId: extra.id,
        teachingId,
        reason: "FIXED_CONFLICT",
        message: `Locked entry ${extra.id} is an extra session: ${teaching.unitCode} requires ${sessionsPerWeek} per week, already covered by the ${counted} locked ${counted === 1 ? "row" : "rows"} counted for it. It was kept on the board untouched and nothing was generated for it. Remove it or unlock it if it was not intended.`,
      });
    }
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
    softScore: softScoreOf(entries, context, policy),
  };
}
