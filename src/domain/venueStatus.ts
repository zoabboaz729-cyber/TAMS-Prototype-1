/** M5-T1: pure weekly, schedule-derived venue state. Prototype decisions: docs/M5-DESIGN.md. */
import { z } from "zod";
import { DEFAULT_POLICY } from "./policy";
import { DaySchema, VenueStatusSchema, VenueTypeSchema } from "./types";

export const VENUE_CLOCK_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export const VenueClockSchema = z.object({
  day: z.enum(VENUE_CLOCK_DAYS), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).strict();
export type VenueClock = z.infer<typeof VenueClockSchema>;
const time = VenueClockSchema.shape.time;
const id = z.string().trim().min(1);
const entry = z.object({ versionId: id, venueId: id, day: DaySchema, start: time, end: time })
  .refine((v) => v.start < v.end);
const closure = z.object({ venueId: id, day: DaySchema, start: time, end: time })
  .refine((v) => v.start < v.end);
export const VenueStatusVersionSchema = z.object({
  id, semester: z.number().int().min(1).max(2), status: z.literal("PUBLISHED"), entries: z.array(entry),
});
export const StatusVenueSchema = z.object({
  id, code: id, type: VenueTypeSchema, status: VenueStatusSchema, unavailabilities: z.array(closure),
});
export type VenueStatusVersion = z.infer<typeof VenueStatusVersionSchema>;
export type StatusVenue = z.infer<typeof StatusVenueSchema>;
export const VenueStatusPolicySchema = z.object({
  upcomingMinutes: z.number().int().min(0).max(1440),
  days: z.array(DaySchema).min(1).refine((days) => new Set(days).size === days.length),
  slotStart: time, slotEnd: time,
}).strict().refine((p) => p.slotStart < p.slotEnd);
export type VenueStatusPolicy = z.infer<typeof VenueStatusPolicySchema>;
// Dedicated policy avoids changing existing scheduling PolicyConfig fixtures.
export const DEFAULT_VENUE_STATUS_POLICY: VenueStatusPolicy = {
  upcomingMinutes: 30, days: [...DEFAULT_POLICY.days] as z.infer<typeof DaySchema>[],
  slotStart: DEFAULT_POLICY.slotStart, slotEnd: DEFAULT_POLICY.slotEnd,
};
export type ComputedVenueState = "OCCUPIED" | "UPCOMING" | "FREE" | "UNAVAILABLE";
export type VenueStatusResult = {
  ok: true; venueId: string; status: ComputedVenueState; asOf: VenueClock;
  nextFreeAt: VenueClock | null; nextScheduledAt: VenueClock | null;
  outsideHours: boolean; nextFreeOutsideHours: boolean;
  unavailableKind: "operational" | "closure" | null; integrityCount: number;
} | {
  ok: false; kind: "INVALID_POLICY" | "INVALID_VENUE" | "INVALID_PUBLISHED_DATA" | "INVALID_CLOCK";
  message: string;
};
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const hhmm = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const overlaps = (a: {start: string; end: string}, b: {start: string; end: string}) => a.start < b.end && b.start < a.end;

/** Validate before precedence: corrupt data must never look like an available venue. */
export function venueStatus(
  versionInput: unknown, venueInput: unknown, clockInput: unknown,
  policyInput: unknown = DEFAULT_VENUE_STATUS_POLICY,
): VenueStatusResult {
  const cp = VenueClockSchema.safeParse(clockInput);
  if (!cp.success) return { ok: false, kind: "INVALID_CLOCK", message: "Choose a weekday and valid 24-hour HH:MM time." };
  const pp = VenueStatusPolicySchema.safeParse(policyInput);
  if (!pp.success) return { ok: false, kind: "INVALID_POLICY", message: "Venue status policy is invalid; ask an officer to review it." };
  const vp = StatusVenueSchema.safeParse(venueInput);
  if (!vp.success) return { ok: false, kind: "INVALID_VENUE", message: "Venue data is invalid; ask an officer to review it." };
  const sp = VenueStatusVersionSchema.safeParse(versionInput);
  if (!sp.success) return { ok: false, kind: "INVALID_PUBLISHED_DATA", message: "Published timetable data is invalid; ask an officer to review it." };
  const now = cp.data, venue = vp.data, version = sp.data, policy = pp.data;
  if (version.entries.some((e) => e.versionId !== version.id || !policy.days.includes(e.day)) ||
      venue.unavailabilities.some((u) => u.venueId !== venue.id || !policy.days.includes(u.day))) {
    return { ok: false, kind: "INVALID_PUBLISHED_DATA", message: "Published timetable links or closure data are invalid; ask an officer to review them." };
  }
  const bookings = version.entries.filter((e) => e.venueId === venue.id && e.day === now.day)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const closures = venue.unavailabilities.filter((u) => u.day === now.day);
  const blocks = [...bookings, ...closures].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  let integrityCount = 0;
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) if (overlaps(bookings[i], bookings[j])) integrityCount++;
    for (const u of closures) if (overlaps(bookings[i], u)) integrityCount++;
  }
  const currentClosure = closures.some((u) => u.start <= now.time && now.time < u.end);
  const currentBooking = bookings.some((b) => b.start <= now.time && now.time < b.end);
  const next = bookings.find((b) => b.start > now.time);
  const closureIntervenes = next !== undefined && closures.some((u) => u.end > now.time && u.start <= next.start);
  const operational = venue.status !== "ACTIVE";
  const status: ComputedVenueState = operational || currentClosure ? "UNAVAILABLE" :
    currentBooking ? "OCCUPIED" : next && !closureIntervenes && minutes(next.start) - minutes(now.time) <= policy.upcomingMinutes ? "UPCOMING" : "FREE";
  let free = minutes(now.time);
  // Sorted sweep merges all overlapping OR touching blocks containing the current instant.
  for (const b of blocks) {
    const start = minutes(b.start), end = minutes(b.end);
    if (start <= free && free < end) free = end;
  }
  const outside = (t: string) => !policy.days.some((day) => day === now.day) || t < policy.slotStart || t >= policy.slotEnd;
  return {
    ok: true, venueId: venue.id, status, asOf: now,
    nextFreeAt: operational ? null : { day: now.day, time: hhmm(free) },
    nextScheduledAt: next ? { day: now.day, time: next.start } : null,
    outsideHours: outside(now.time), nextFreeOutsideHours: !operational && outside(hhmm(free)),
    unavailableKind: operational ? "operational" : currentClosure ? "closure" : null, integrityCount,
  };
}
