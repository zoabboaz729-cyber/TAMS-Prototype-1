/** Server orchestration: trusted actor, strict request, one snapshot, redacted output. */
import { venueActivityLabel } from "@/domain/venueActivity";
import { M6Error } from "./m6Errors";
import { campusDateTime, inTerm, termFor, weekday } from "@/domain/termCalendar";
import { decideAnyAccess } from "@/domain/access";
import type { Actor } from "@/domain/permissions";
import { UserRoleSchema } from "@/domain/types";
import { DEFAULT_VENUE_STATUS_POLICY, StatusVenueSchema, VenueClockSchema, venueStatus } from "@/domain/venueStatus";
import { VENUE_STATUS_MESSAGES, VenueStatusRequestSchema, VenueStatusSnapshotSchema,
  type VenueStatusBoardResult, type VenueStatusFailure, type VenueStatusFailureKind, type VenueStatusStore } from "./venueStatusContract";
const fail = (kind: VenueStatusFailureKind): VenueStatusFailure => ({ ok: false, kind, message: VENUE_STATUS_MESSAGES[kind] });
export function canUseVenueDemoClock(actor: Actor): boolean {
  return actor.role === "OFFICER" || actor.role === "ADMIN";
}
/** Date is injected by caller; campus conversion does not depend on host/client timezone. */
export function campusVenueClock(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  return VenueClockSchema.parse({
    day: parts.find((p) => p.type === "weekday")?.value.toUpperCase(),
    time: `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`,
  });
}
export async function readVenueStatus(
  actor: Actor | null, input: unknown, store: VenueStatusStore, now: () => Date,
): Promise<VenueStatusBoardResult> {
  if (actor === null) return fail("UNAUTHENTICATED");
  if (!UserRoleSchema.safeParse(actor.role).success || !actor.id || decideAnyAccess(actor, "VIEW_VENUE_STATUS").status !== "ALLOW") return fail("FORBIDDEN");
  const request = VenueStatusRequestSchema.safeParse(input);
  if (!request.success) return fail("INVALID_INPUT");
  const q = request.data, mode = q.mode === "demo-date" ? "demo" : q.mode ?? "live";
  if (mode === "demo" && !canUseVenueDemoClock(actor)) return fail("FORBIDDEN");
  try {
    const instant = mode === "live" ? now() : null;
    const date = q.mode === "demo-date" ? q.date : mode === "live" ? campusDateTime(instant!).date : undefined;
    if (q.mode === "demo-date" && !inTerm(q.date,termFor(Number(q.semester)))) return fail("INVALID_INPUT");
    const clock = VenueClockSchema.safeParse(q.mode === "demo-date" ? { day: weekday(q.date), time: q.time } : q.mode === "demo" ? { day: q.day, time: q.time } : campusVenueClock(instant!));
    if (!clock.success) return fail("INVALID_CLOCK");
    const semester = Number(q.semester);
    const data = VenueStatusSnapshotSchema.safeParse(await (mode === "live" && date && instant && store.readLiveSnapshot ? store.readLiveSnapshot(semester,date,instant) : date && store.readDatedSnapshot ? store.readDatedSnapshot(semester,date) : store.readSnapshot(semester)));
    if (!data.success) return fail("INVALID_PUBLISHED_DATA");
    const { versions, entries } = data.data;
    if (versions.length === 0) return fail("NO_PUBLISHED_VERSION");
    if (versions.length > 1) return fail("AMBIGUOUS_PUBLISHED_VERSION");
    const pub = versions[0];
    if (pub.status !== "PUBLISHED" || pub.semester !== semester || pub.publishedAt === null) return fail("INVALID_PUBLISHED_DATA");
    const venueParses = data.data.venues.map((v) => StatusVenueSchema.safeParse(v));
    if (venueParses.some((v) => !v.success)) return fail("INVALID_PUBLISHED_DATA");
    const venues = venueParses.flatMap((v) => v.success ? [v.data] : []);
    const ids = new Set(venues.map((v) => v.id)), codes = new Set(venues.map((v) => v.code));
    if (ids.size !== venues.length || codes.size !== venues.length ||
        entries.some((e) => e.unitSemester !== semester || e.versionId !== pub.id || !ids.has(e.venueId))) return fail("INVALID_PUBLISHED_DATA");
    // Validate entries even when the venue register is empty: no silently dropped malformed rows.
    const version = { id: pub.id, semester, status: pub.status, entries };
    const rows = [];
    let integrityCount = 0;
    for (const venue of [...venues].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0)) {
      const result = venueStatus(version, venue, clock.data, DEFAULT_VENUE_STATUS_POLICY);
      if (!result.ok) return fail("INVALID_PUBLISHED_DATA");
      integrityCount += result.integrityCount;
      const evidence = data.data.activityEvidence?.find(e=>e.venueId===venue.id);
      rows.push({ ...(data.data.activityEvidence ? {activityLabel:venueActivityLabel(result.status,evidence?.activity??null,evidence?.attendance??"NOT_OPENED",evidence?.hasMarks?1:0)} : {}), code: venue.code, type: venue.type, status: result.status,
        nextFreeAt: result.nextFreeAt, nextScheduledAt: result.nextScheduledAt,
        nextFreeOutsideHours: result.nextFreeOutsideHours, unavailableKind: result.unavailableKind });
    }
    const asOf = clock.data;
    const outsideHours = !DEFAULT_VENUE_STATUS_POLICY.days.some((d) => d === asOf.day) || asOf.time < DEFAULT_VENUE_STATUS_POLICY.slotStart || asOf.time >= DEFAULT_VENUE_STATUS_POLICY.slotEnd;
    return { ok: true, semester, publication: { id: pub.id, publishedAt: pub.publishedAt.toISOString() },
      mode, asOf, outsideHours, rows, ...(data.data.actualDate ? { actualDate:data.data.actualDate,dateApplied:data.data.dateApplied } : {}), ...(canUseVenueDemoClock(actor) ? { integrityCount } : {}) };
  } catch (error) {
    if (error instanceof M6Error && error.code === "DATE_OUT_OF_TERM") return fail("OUTSIDE_TERM");
    // No exception logging: DB paths, SQL and credentials must never cross this boundary.
    return fail("INTERNAL_ERROR");
  }
}
