/**
 * Bounded backtracking search for the TAMS timetable generator
 * (PROTOTYPE_SPEC §7 hard constraints, task M4-T1).
 *
 * Pure domain logic: no database, network, Next.js, or clock. Everything the
 * search needs is passed in through {@link SearchContext}, and the same
 * primitives the accepted M3 validator uses — `timesOverlap`,
 * `findUnavailableConflict`, `checkSlot` — decide what a clash is here, so the
 * generator and the validator can never disagree about a conflict
 * (DECISIONS.md M4-T1 decision (c)).
 *
 * Type-only imports from `./generator` are erased at compile time, so the
 * runtime dependency graph runs one-way: generator → generatorSearch
 * (the same pattern M3-T1b uses for slotValidation.ts).
 */

import type { EntryInput } from "./validator";
import { checkSlot } from "./slotValidation";
import {
  findUnavailableConflict,
  timesOverlap,
  type StoredUnavailablePeriod,
} from "./lecturerAvailability";
import { TIME_HHMM_REGEX, isStartBeforeEnd } from "./types";
import type { PolicyConfig } from "./policy";
import type { GeneratorPeriod, GeneratorVenue } from "./generator";

/** One session that still needs a day, a time and a venue. */
export type Activity = {
  id: string;
  teachingId: string;
  /** 1-based session number within its teaching. */
  index: number;
  unitCode: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  venueTypeRequired: string;
  /** Contact length of this session in minutes. */
  durationMinutes: number;
};

/** A placed session with its activity, for the soft scorer. */
export type PlacedActivity = { activity: Activity; entry: EntryInput };

/** Why an activity could not be placed. */
export type ActivityFailure = "NO_COMPATIBLE_VENUE" | "NO_FREE_SLOT" | "STEP_LIMIT";

export type UnplacedActivity = { activity: Activity; reason: ActivityFailure; message: string };

export type SearchOutcome = {
  /** Generated placements only — pre-placed fixed rows are not included. */
  placed: PlacedActivity[];
  unplaced: UnplacedActivity[];
  stepsUsed: number;
  limitReached: boolean;
};

export type SearchContext = {
  /** Hourly grid slots per session length in minutes. */
  slotGrids: ReadonlyMap<number, readonly Slot[]>;
  venues: ReadonlyMap<string, GeneratorVenue>;
  lecturerPeriods: ReadonlyMap<string, StoredUnavailablePeriod[]>;
  venuePeriods: ReadonlyMap<string, readonly GeneratorPeriod[]>;
  policy: PolicyConfig;
  /** ASSUMPTION-10 limits are hard in the first pass, soft (scored) in the second. */
  enforceLoadLimits: boolean;
  stepLimit: number;
};

export type Slot = { day: string; dayIndex: number; start: string; end: string };

type Candidate = {
  venueId: string;
  day: string;
  dayIndex: number;
  start: string;
  end: string;
  waste: number;
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isValidRange(start: string, end: string): boolean {
  return TIME_HHMM_REGEX.test(start) && TIME_HHMM_REGEX.test(end) && isStartBeforeEnd(start, end);
}

/** Minutes a period blocks inside the policy slot window (0 when it blocks nothing). */
function blockedMinutes(period: GeneratorPeriod, policy: PolicyConfig): number {
  if (!policy.days.includes(period.day) || !isValidRange(period.start, period.end)) return 0;
  const from = Math.max(toMinutes(period.start), toMinutes(policy.slotStart));
  const to = Math.min(toMinutes(period.end), toMinutes(policy.slotEnd));
  return to > from ? to - from : 0;
}

/**
 * Every hourly grid slot a session of `durationMinutes` can occupy, in policy
 * day order then ascending start. The lunch window is rejected with the same
 * `timesOverlap` the validator uses, so the generator never proposes a slot the
 * validator would call OUT_OF_SLOT. A malformed policy yields no slots.
 */
export function buildSlotGrid(policy: PolicyConfig, durationMinutes: number): Slot[] {
  const slots: Slot[] = [];
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return slots;
  if (!isValidRange(policy.slotStart, policy.slotEnd)) return slots;

  const windowStart = toMinutes(policy.slotStart);
  const windowEnd = toMinutes(policy.slotEnd);

  for (let dayIndex = 0; dayIndex < policy.days.length; dayIndex++) {
    const day = policy.days[dayIndex];
    for (let start = windowStart; start + durationMinutes <= windowEnd; start += 60) {
      const end = toHHMM(start + durationMinutes);
      const startHHMM = toHHMM(start);
      if (timesOverlap(startHHMM, end, policy.lunchStart, policy.lunchEnd)) continue;
      slots.push({ day, dayIndex, start: startHHMM, end });
    }
  }
  return slots;
}

/**
 * Venues matching the unit's type and holding the group — the same two
 * comparisons CAPACITY and VENUE_TYPE make — least spare capacity first.
 */
function compatibleVenues(
  activity: Activity,
  context: SearchContext,
): { venueId: string; venueCode: string; waste: number }[] {
  const list: { venueId: string; venueCode: string; waste: number }[] = [];
  for (const venue of context.venues.values()) {
    if (venue.type !== activity.venueTypeRequired) continue;
    if (venue.capacity < activity.expectedSize) continue;
    list.push({
      venueId: venue.id,
      venueCode: venue.code,
      waste: venue.capacity - activity.expectedSize,
    });
  }
  list.sort((a, b) => a.waste - b.waste || cmp(a.venueId, b.venueId));
  return list;
}

/** Mutable placement state. Every place has an exact undo so the search can backtrack. */
export class SearchState {
  private readonly rowsByDay = new Map<string, Row[]>();
  readonly lecturerDayHours = new Map<string, number>();
  readonly groupDayClasses = new Map<string, number>();
  /** Generated placements only, in the order the search committed them. */
  placed: PlacedActivity[] = [];

  /** Seed a locked/fixed row so the search must work around it. */
  preplace(row: { venueId: string; lecturerId: string; groupId: string; day: string; start: string; end: string }): void {
    this.add(row);
    this.counts(row, 1);
  }

  place(activity: Activity, entry: EntryInput): void {
    this.add({ ...entry, lecturerId: activity.lecturerId, groupId: activity.groupId });
    this.counts(
      {
        lecturerId: activity.lecturerId,
        groupId: activity.groupId,
        day: entry.day,
        start: entry.start,
        end: entry.end,
      },
      1,
    );
    this.placed.push({ activity, entry });
  }

  undo(): void {
    const last = this.placed[this.placed.length - 1];
    if (!last) return;
    this.placed.pop();
    const { activity, entry } = last;
    this.remove(entry);
    this.counts(
      {
        lecturerId: activity.lecturerId,
        groupId: activity.groupId,
        day: entry.day,
        start: entry.start,
        end: entry.end,
      },
      -1,
    );
  }

  private add(row: Row): void {
    const rows = this.rowsByDay.get(row.day);
    if (rows) rows.push(row);
    else this.rowsByDay.set(row.day, [row]);
  }

  private remove(row: { id?: string; day: string }): void {
    const rows = this.rowsByDay.get(row.day) ?? [];
    const index = rows.findIndex((existing) => existing.id === row.id);
    if (index >= 0) rows.splice(index, 1);
  }

  private counts(
    ref: { lecturerId: string; groupId?: string; day: string; start: string; end: string },
    sign: number,
  ): void {
    const minutes = toMinutes(ref.end) - toMinutes(ref.start);
    const hoursKey = `${ref.lecturerId}|${ref.day}`;
    this.lecturerDayHours.set(hoursKey, (this.lecturerDayHours.get(hoursKey) ?? 0) + sign * minutes);
    if (!ref.groupId) return;
    const classesKey = `${ref.groupId}|${ref.day}`;
    this.groupDayClasses.set(classesKey, (this.groupDayClasses.get(classesKey) ?? 0) + sign);
  }

  rowsForDay(day: string): readonly Row[] {
    return this.rowsByDay.get(day) ?? [];
  }
}

type Row = {
  /** Absent on a pre-placed fixed row, which the search never removes. */
  id?: string;
  venueId: string;
  lecturerId: string;
  groupId: string;
  day: string;
  start: string;
  end: string;
};

/**
 * Hard-rule check for one candidate, using the validator's own primitives:
 * capacity, type, slot grid, lecturer and venue unavailability, and the three
 * overlap rules against everything already on the board.
 */
function isFeasible(
  activity: Activity,
  candidate: Candidate,
  state: SearchState,
  context: SearchContext,
): boolean {
  const venue = context.venues.get(candidate.venueId);
  if (!venue) return false;
  if (venue.capacity < activity.expectedSize) return false;
  if (venue.type !== activity.venueTypeRequired) return false;

  const probe: EntryInput = {
    id: activity.id,
    teachingId: activity.teachingId,
    venueId: candidate.venueId,
    day: candidate.day,
    start: candidate.start,
    end: candidate.end,
  };
  if (checkSlot(probe, context.policy)) return false;

  const lecturerPeriods = context.lecturerPeriods.get(activity.lecturerId) ?? [];
  if (findUnavailableConflict(probe, lecturerPeriods)) return false;

  for (const period of context.venuePeriods.get(candidate.venueId) ?? []) {
    if (period.day !== candidate.day) continue;
    if (!isValidRange(period.start, period.end)) continue;
    if (timesOverlap(candidate.start, candidate.end, period.start, period.end)) return false;
  }

  for (const row of state.rowsForDay(candidate.day)) {
    if (!timesOverlap(candidate.start, candidate.end, row.start, row.end)) continue;
    if (row.venueId === candidate.venueId) return false;
    if (row.lecturerId === activity.lecturerId) return false;
    if (row.groupId === activity.groupId) return false;
  }

  if (context.enforceLoadLimits) {
    const minutes = toMinutes(candidate.end) - toMinutes(candidate.start);
    const hours = state.lecturerDayHours.get(`${activity.lecturerId}|${candidate.day}`) ?? 0;
    if (hours + minutes > context.policy.maxHoursPerLecturerPerDay * 60) return false;
    const classes = state.groupDayClasses.get(`${activity.groupId}|${candidate.day}`) ?? 0;
    if (classes + 1 > context.policy.maxClassesPerGroupPerDay) return false;
  }
  return true;
}

/**
 * Scarce first: fewest matching venues, then the lecturer with the most blocked
 * contact minutes, then the largest group, then the longest session, then ids.
 * A total order, so the same input always searches in the same sequence.
 */
export function orderActivities(
  activities: readonly Activity[],
  context: SearchContext,
): Activity[] {
  const blockedByLecturer = new Map<string, number>();
  for (const [lecturerId, periods] of context.lecturerPeriods) {
    let minutes = 0;
    for (const period of periods) minutes += blockedMinutes(period, context.policy);
    blockedByLecturer.set(lecturerId, minutes);
  }

  const scored = activities.map((activity) => ({
    activity,
    venueCount: compatibleVenues(activity, context).length,
    blocked: blockedByLecturer.get(activity.lecturerId) ?? 0,
    contact: activity.durationMinutes,
  }));

  scored.sort((a, b) => {
    if (a.venueCount !== b.venueCount) return a.venueCount - b.venueCount;
    if (a.blocked !== b.blocked) return b.blocked - a.blocked;
    if (a.activity.expectedSize !== b.activity.expectedSize) {
      return b.activity.expectedSize - a.activity.expectedSize;
    }
    if (a.contact !== b.contact) return b.contact - a.contact;
    if (a.activity.teachingId !== b.activity.teachingId) {
      return cmp(a.activity.teachingId, b.activity.teachingId);
    }
    return a.activity.index - b.activity.index;
  });
  return scored.map((item) => item.activity);
}

function candidateList(activity: Activity, context: SearchContext): Candidate[] {
  const venues = compatibleVenues(activity, context);
  if (venues.length === 0) return [];
  const minutes = activity.durationMinutes;
  const slots = context.slotGrids.get(minutes) ?? [];

  const candidates: Candidate[] = [];
  for (const slot of slots) {
    for (const venue of venues) {
      candidates.push({
        venueId: venue.venueId,
        day: slot.day,
        dayIndex: slot.dayIndex,
        start: slot.start,
        end: slot.end,
        waste: venue.waste,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.dayIndex - b.dayIndex ||
      toMinutes(a.start) - toMinutes(b.start) ||
      a.waste - b.waste ||
      cmp(a.venueId, b.venueId),
  );
  return candidates;
}

/** Plain-language reason naming the rule that left the activity nowhere to go. */
export function searchMessage(
  reason: ActivityFailure,
  activity: Activity,
  context: SearchContext,
): string {
  const session = `${Number.isInteger(activity.durationMinutes / 60) ? activity.durationMinutes / 60 : (activity.durationMinutes / 60).toFixed(2)}h`;
  const venues = compatibleVenues(activity, context);

  if (reason === "STEP_LIMIT") {
    return `The search stopped at its limit of ${context.stepLimit} candidate checks before ${activity.unitCode} session ${activity.index} was reached.`;
  }
  if (venues.length === 0) {
    return `No venue is a ${activity.venueTypeRequired} with room for ${activity.expectedSize} students, so ${activity.unitCode} session ${activity.index} cannot be placed.`;
  }
  if (context.enforceLoadLimits) {
    return `Every ${session} ${activity.venueTypeRequired} slot for ${activity.unitCode} session ${activity.index} is taken or would exceed the policy day limits (max ${context.policy.maxHoursPerLecturerPerDay}h per lecturer per day, max ${context.policy.maxClassesPerGroupPerDay} classes per group per day). Venues that fit: ${venues.map((v) => v.venueCode).join(", ")}.`;
  }
  return `Every ${session} slot for ${activity.unitCode} session ${activity.index} is already used by its lecturer, its group or one of ${venues.map((v) => v.venueCode).join(", ")} at that time, or falls outside the allowed slots.`;
}

/**
 * Why an activity had nothing to try. No venue of the right type and size is a
 * different answer for the officer than a venue that exists but has no free
 * slot inside the allowed window, so the two are reported apart.
 */
function exhaustedReason(activity: Activity, context: SearchContext): ActivityFailure {
  return compatibleVenues(activity, context).length === 0 ? "NO_COMPATIBLE_VENUE" : "NO_FREE_SLOT";
}

/**
 * Bounded, best-effort depth-first search over the ordered activities.
 *
 * Within one pass, the first feasible candidate is taken and, when a later
 * activity has nowhere to go, the most recent placement is undone and its next
 * candidate tried. If that pass cannot reach the end, the run it got furthest
 * with is kept, the activities it placed are removed from the search, and the
 * next pass starts at the first activity that is still unfixed. That way a
 * single activity with no possible slot — the SE-Y4 lab sessions in the seeded
 * data have no lab large enough — costs only itself instead of discarding every
 * placement made around it, so no session is ever silently dropped.
 *
 * Every candidate examined costs one step against the shared `context.stepLimit`
 * budget, across all passes, so the search can never run indefinitely; when the
 * budget runs out the remaining activities are reported as STEP_LIMIT.
 */
export function runSearch(
  ordered: readonly Activity[],
  context: SearchContext,
  createState: () => SearchState,
): SearchOutcome {
  const state = createState();
  const candidates = ordered.map((activity) => candidateList(activity, context));
  const failures = new Map<number, ActivityFailure>();
  let steps = 0;
  let limitReached = false;
  let cursor = 0;

  // Set per pass: the DFS restarts from the placements already committed by the
  // previous passes, so `chunkBase` is the bottom of this pass's own stack.
  let chunkBase = 0;
  let bestInChunk: PlacedActivity[] = [];

  const visit = (index: number): boolean => {
    if (index >= ordered.length) return true;
    const activity = ordered[index];
    let usable = 0;

    for (const candidate of candidates[index]) {
      if (steps >= context.stepLimit) {
        limitReached = true;
        return false;
      }
      steps++;
      if (!isFeasible(activity, candidate, state, context)) continue;
      usable++;
      state.place(activity, {
        id: activity.id,
        teachingId: activity.teachingId,
        venueId: candidate.venueId,
        day: candidate.day,
        start: candidate.start,
        end: candidate.end,
      });
      if (state.placed.length - chunkBase > bestInChunk.length) {
        bestInChunk = state.placed.slice(chunkBase);
      }
      if (visit(index + 1)) return true;
      state.undo();
    }

    if (limitReached) failures.set(index, "STEP_LIMIT");
    else if (candidates[index].length === 0) failures.set(index, exhaustedReason(activity, context));
    else if (usable === 0) failures.set(index, "NO_FREE_SLOT");
    return false;
  };

  while (cursor < ordered.length) {
    if (steps >= context.stepLimit) {
      limitReached = true;
      break;
    }
    chunkBase = state.placed.length;
    bestInChunk = [];
    if (visit(cursor)) break;

    // A failed pass unwinds everything it placed, so replaying the deepest run
    // both keeps those placements and pins them for the next pass.
    for (const item of bestInChunk) state.place(item.activity, item.entry);
    cursor += bestInChunk.length > 0 ? bestInChunk.length : 1;
    if (limitReached) break;
  }

  const placedIds = new Set(state.placed.map((item) => item.activity.id));
  const unplaced: UnplacedActivity[] = [];

  for (let index = 0; index < ordered.length; index++) {
    const activity = ordered[index];
    if (placedIds.has(activity.id)) continue;
    const reason =
      failures.get(index) ??
      (limitReached ? "STEP_LIMIT" : exhaustedReason(activity, context));
    unplaced.push({ activity, reason, message: searchMessage(reason, activity, context) });
  }

  return { placed: state.placed, unplaced, stepsUsed: steps, limitReached };
}
