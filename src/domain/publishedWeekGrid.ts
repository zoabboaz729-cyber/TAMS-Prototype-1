/**
 * Pure weekly-grid model for an already-selected set of published timetable
 * entries (M4-T4c, PROTOTYPE_SPEC §7 / M4-T4). Represents the group, lecturer
 * and venue perspectives the accepted readPublishedTimetable() service returns;
 * it makes no publication, permission, version or completeness decision and never
 * re-runs the M3 validator. No React, Prisma, Next.js, server action, database,
 * clock, random value or environment read. `DisplayableEntry` is a type-only import
 * (erased at compile time), so the runtime graph stays one-way and pure.
 *
 * Granularity decision (DECISIONS M4-T4c): the grid is HOUR-ALIGNED only. Every
 * policy boundary and every entry start/end must fall on an exact hour and a
 * session spans a whole number of one-hour slots. Off-hour data (e.g. 08:30) is
 * rejected, never rounded. Lunch is a visible non-teaching row; an entry that
 * overlaps it is a typed invalid entry, not a silently repositioned session.
 *
 * A success result means "renderable", NOT "conflict-free": overlapping stored
 * entries are both preserved, marked, and given deterministic side-by-side lanes.
 */
import type { PolicyConfig } from "./policy";
import type { DisplayableEntry } from "@/server/publishedTimetableContract";
import { TIME_HHMM_REGEX } from "./types";

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/** One teaching-day column, in policy order. */
export type WeekDay = { day: string; index: number };

/** One shared hour row. Lunch rows are flagged, never removed. */
export type WeekSlot = {
  id: string;
  index: number;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  isLunch: boolean;
};

/** A positioned session: one coherent block, never split or duplicated. */
export type PlacedSession = {
  entryId: string;
  versionId: string;
  teachingId: string;
  day: string;
  dayIndex: number;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  /** First occupied hour row. */
  startSlotIndex: number;
  /** One past the last occupied hour row. */
  endSlotIndex: number;
  slotSpan: number;
  /** Side-by-side column within its overlap cluster (0 when alone). */
  lane: number;
  /** Total lanes in its overlap cluster (1 when alone). */
  laneCount: number;
  /** Ids of entries this one directly overlaps, id-sorted; empty when none. */
  overlappingEntryIds: string[];
  unitCode: string;
  unitTitle: string;
  groupId: string;
  groupName: string;
  lecturerId: string;
  lecturerName: string;
  venueId: string;
  venueCode: string;
};

export type PublishedWeekGrid = {
  days: readonly WeekDay[];
  slots: readonly WeekSlot[];
  sessions: readonly PlacedSession[];
  /** True when any stored entries overlap. Success alone never implies this is false. */
  hasOverlaps: boolean;
  slotDurationMinutes: number;
};

export type GridPolicyProperty = "days" | "slotStart" | "slotEnd" | "lunchStart" | "lunchEnd";

export type EntryInvalidReason =
  | "MISSING_ID"
  | "DUPLICATE_ID"
  | "UNSUPPORTED_DAY"
  | "INVALID_TIME"
  | "NON_POSITIVE_DURATION"
  | "OFF_GRID"
  | "OUTSIDE_WINDOW"
  | "LUNCH_OVERLAP";

/** Discriminated outcome: a renderable grid, an invalid policy, or an invalid entry. */
export type PublishedWeekGridResult =
  | { ok: true; grid: PublishedWeekGrid }
  | { ok: false; kind: "INVALID_POLICY"; property: GridPolicyProperty; message: string }
  | { ok: false; kind: "INVALID_ENTRY"; entryId: string; reason: EntryInvalidReason; message: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const SLOT_MINUTES = 60;

/** HH:MM (00:00–23:59, exact domain format) to minute offset, or null. No Date. */
function parseHHMM(value: string): number | null {
  if (!TIME_HHMM_REGEX.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function formatHHMM(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function invalidPolicy(property: GridPolicyProperty, message: string): PublishedWeekGridResult {
  return { ok: false, kind: "INVALID_POLICY", property, message };
}

function invalidEntry(entryId: string, reason: EntryInvalidReason, message: string): PublishedWeekGridResult {
  return { ok: false, kind: "INVALID_ENTRY", entryId, reason, message };
}

// ---------------------------------------------------------------------------
// Policy validation (rendering-relevant values only)
// ---------------------------------------------------------------------------

type ValidPolicy = {
  days: readonly string[];
  slotStart: number;
  slotEnd: number;
  lunchStart: number;
  lunchEnd: number;
};

function policyTime(value: string, property: GridPolicyProperty): number | PublishedWeekGridResult {
  const minutes = parseHHMM(value);
  if (minutes === null) return invalidPolicy(property, `${property} must be a valid 24-hour HH:MM time.`);
  if (minutes % SLOT_MINUTES !== 0) return invalidPolicy(property, `${property} must be hour-aligned; the grid renders whole-hour slots only.`);
  return minutes;
}

function validatePolicy(policy: PolicyConfig): ValidPolicy | PublishedWeekGridResult {
  const days = policy.days;
  if (!Array.isArray(days) || days.length === 0) return invalidPolicy("days", "The policy must list at least one teaching day.");
  const seen = new Set<string>();
  for (const day of days) {
    if (typeof day !== "string" || day.trim() === "") return invalidPolicy("days", "Every teaching day must be a non-blank label.");
    if (seen.has(day)) return invalidPolicy("days", `Teaching day "${day}" is listed more than once.`);
    seen.add(day);
  }
  const slotStart = policyTime(policy.slotStart, "slotStart");
  if (typeof slotStart !== "number") return slotStart;
  const slotEnd = policyTime(policy.slotEnd, "slotEnd");
  if (typeof slotEnd !== "number") return slotEnd;
  const lunchStart = policyTime(policy.lunchStart, "lunchStart");
  if (typeof lunchStart !== "number") return lunchStart;
  const lunchEnd = policyTime(policy.lunchEnd, "lunchEnd");
  if (typeof lunchEnd !== "number") return lunchEnd;
  if (slotStart >= slotEnd) return invalidPolicy("slotStart", "The earliest start must be before the latest end.");
  if (lunchStart >= lunchEnd) return invalidPolicy("lunchStart", "Lunch start must be before lunch end.");
  if (lunchStart < slotStart) return invalidPolicy("lunchStart", "Lunch must begin within the rendered teaching window.");
  if (lunchEnd > slotEnd) return invalidPolicy("lunchEnd", "Lunch must end within the rendered teaching window.");
  return { days, slotStart, slotEnd, lunchStart, lunchEnd };
}

// ---------------------------------------------------------------------------
// Entry validation (canonical order makes the chosen offender input-independent)
// ---------------------------------------------------------------------------

type ValidEntry = { entry: DisplayableEntry; startMinutes: number; endMinutes: number };

function compareCanonical(a: DisplayableEntry, b: DisplayableEntry): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.end !== b.end) return a.end < b.end ? -1 : 1;
  return 0;
}

function validateEntry(entry: DisplayableEntry, policy: ValidPolicy, seenIds: Set<string>): ValidEntry | PublishedWeekGridResult {
  const id = entry.id;
  if (typeof id !== "string" || id.trim() === "") return invalidEntry("", "MISSING_ID", "A published entry is missing the id needed to render it stably.");
  if (seenIds.has(id)) return invalidEntry(id, "DUPLICATE_ID", `Published entry id "${id}" appears more than once.`);
  seenIds.add(id);
  if (!policy.days.includes(entry.day)) return invalidEntry(id, "UNSUPPORTED_DAY", `Entry ${id} is on "${entry.day}", which is not a teaching day in this policy.`);
  const startMinutes = parseHHMM(entry.start);
  const endMinutes = parseHHMM(entry.end);
  if (startMinutes === null || endMinutes === null) return invalidEntry(id, "INVALID_TIME", `Entry ${id} has a time that is not a valid 24-hour HH:MM value.`);
  if (startMinutes >= endMinutes) return invalidEntry(id, "NON_POSITIVE_DURATION", `Entry ${id} must start before it ends.`);
  if (startMinutes % SLOT_MINUTES !== 0 || endMinutes % SLOT_MINUTES !== 0) return invalidEntry(id, "OFF_GRID", `Entry ${id} is not hour-aligned; the grid cannot place ${entry.start}–${entry.end} without rounding.`);
  if (startMinutes < policy.slotStart || endMinutes > policy.slotEnd) return invalidEntry(id, "OUTSIDE_WINDOW", `Entry ${id} falls outside the ${formatHHMM(policy.slotStart)}–${formatHHMM(policy.slotEnd)} teaching window.`);
  if (startMinutes < policy.lunchEnd && policy.lunchStart < endMinutes) return invalidEntry(id, "LUNCH_OVERLAP", `Entry ${id} overlaps the ${formatHHMM(policy.lunchStart)}–${formatHHMM(policy.lunchEnd)} lunch break.`);
  return { entry, startMinutes, endMinutes };
}

// ---------------------------------------------------------------------------
// Deterministic layout: spans, overlap clusters and side-by-side lanes
// ---------------------------------------------------------------------------

function placeSession(valid: ValidEntry, policy: ValidPolicy, dayIndex: number): PlacedSession {
  const { entry, startMinutes, endMinutes } = valid;
  const startSlotIndex = (startMinutes - policy.slotStart) / SLOT_MINUTES;
  const endSlotIndex = (endMinutes - policy.slotStart) / SLOT_MINUTES;
  return {
    entryId: entry.id, versionId: entry.versionId, teachingId: entry.teachingId,
    day: entry.day, dayIndex, start: entry.start, end: entry.end, startMinutes, endMinutes,
    durationMinutes: endMinutes - startMinutes, startSlotIndex, endSlotIndex, slotSpan: endSlotIndex - startSlotIndex,
    lane: 0, laneCount: 1, overlappingEntryIds: [],
    unitCode: entry.unitCode, unitTitle: entry.unitTitle, groupId: entry.groupId, groupName: entry.groupName,
    lecturerId: entry.lecturerId, lecturerName: entry.lecturerName, venueId: entry.venueId, venueCode: entry.venueCode,
  };
}

/** Lowest free lane per session in start order; lane count = peak concurrency. */
function assignLanes(cluster: PlacedSession[]): void {
  const laneEnds: number[] = [];
  for (const session of cluster) {
    let lane = laneEnds.findIndex((end) => end <= session.startMinutes);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(session.endMinutes); }
    else laneEnds[lane] = session.endMinutes;
    session.lane = lane;
  }
  for (const session of cluster) session.laneCount = laneEnds.length;
}

/** Mutates only freshly-built sessions: direct overlaps, clusters and lanes. */
function layoutDay(sessions: PlacedSession[]): void {
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      if (sessions[i].endMinutes <= sessions[j].startMinutes) break;
      sessions[i].overlappingEntryIds.push(sessions[j].entryId);
      sessions[j].overlappingEntryIds.push(sessions[i].entryId);
    }
  }
  for (const session of sessions) session.overlappingEntryIds.sort();
  let i = 0;
  while (i < sessions.length) {
    let j = i;
    let maxEnd = sessions[i].endMinutes;
    while (j + 1 < sessions.length && sessions[j + 1].startMinutes < maxEnd) {
      j++;
      maxEnd = Math.max(maxEnd, sessions[j].endMinutes);
    }
    assignLanes(sessions.slice(i, j + 1));
    i = j + 1;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a deterministic weekly grid from already-authorized published entries.
 * Never throws for malformed schedule data, never mutates its inputs, and never
 * returns a successful grid that dropped an invalid entry. An empty list is a
 * valid empty week (days, hour rows and lunch present, no sessions).
 */
export function buildPublishedWeekGrid(
  entries: readonly DisplayableEntry[],
  policy: PolicyConfig,
): PublishedWeekGridResult {
  const validPolicy = validatePolicy(policy);
  if ("ok" in validPolicy) return validPolicy;

  const seenIds = new Set<string>();
  const validated: ValidEntry[] = [];
  for (const entry of [...entries].sort(compareCanonical)) {
    const result = validateEntry(entry, validPolicy, seenIds);
    if ("ok" in result) return result;
    validated.push(result);
  }

  const dayRank = new Map(validPolicy.days.map((day, index) => [day, index]));
  const ordered = validated.sort((a, b) => {
    const rankA = dayRank.get(a.entry.day) ?? 0;
    const rankB = dayRank.get(b.entry.day) ?? 0;
    if (rankA !== rankB) return rankA - rankB;
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    if (a.endMinutes !== b.endMinutes) return a.endMinutes - b.endMinutes;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  const slotCount = (validPolicy.slotEnd - validPolicy.slotStart) / SLOT_MINUTES;
  const slots: WeekSlot[] = [];
  for (let index = 0; index < slotCount; index++) {
    const startMinutes = validPolicy.slotStart + index * SLOT_MINUTES;
    const endMinutes = startMinutes + SLOT_MINUTES;
    slots.push({
      id: `slot-${index}`, index, start: formatHHMM(startMinutes), end: formatHHMM(endMinutes),
      startMinutes, endMinutes, isLunch: startMinutes >= validPolicy.lunchStart && endMinutes <= validPolicy.lunchEnd,
    });
  }

  const sessions = ordered.map((valid) => placeSession(valid, validPolicy, dayRank.get(valid.entry.day) ?? 0));
  for (let index = 0; index < sessions.length; ) {
    let end = index + 1;
    while (end < sessions.length && sessions[end].dayIndex === sessions[index].dayIndex) end++;
    layoutDay(sessions.slice(index, end));
    index = end;
  }

  const days: WeekDay[] = validPolicy.days.map((day, index) => ({ day, index }));
  const grid: PublishedWeekGrid = {
    days, slots, sessions, slotDurationMinutes: SLOT_MINUTES,
    hasOverlaps: sessions.some((session) => session.overlappingEntryIds.length > 0),
  };
  return { ok: true, grid };
}