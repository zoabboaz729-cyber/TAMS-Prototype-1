/** Shared complete schedule read. Caller authorizes before invoking it. */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assessCandidate } from "@/domain/occurrences";
import { termFor } from "@/domain/termCalendar";
import { DaySchema } from "@/domain/types";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { ValidationContext } from "@/domain/validator";
export type M6Client = Prisma.TransactionClient;
export async function readM6Snapshot(tx: M6Client, versionId: string) {
  const version = await tx.timetableVersion.findUniqueOrThrow({ where: { id: versionId } });
  const entries = await tx.timetableEntry.findMany({ where: { versionId }, orderBy: { id: "asc" } });
  const exceptions = await tx.timetableOccurrenceException.findMany({ where: { versionId }, orderBy: { id: "asc" } });
  const teachings = await tx.teaching.findMany({ where: { id: { in: entries.map(e => e.teachingId) } }, include: { unit: true, lecturer: true }, orderBy: { id: "asc" } });
  const venues = await tx.venue.findMany({ where: { id: { in: entries.map(e => e.venueId) } }, orderBy: { id: "asc" } });
  const lecturerUnavailable = await tx.lecturerAvailability.findMany({ where: { lecturerId: { in: teachings.map(t => t.lecturerId) } }, orderBy: { id: "asc" } });
  const venueUnavailable = await tx.venueUnavailable.findMany({ where: { venueId: { in: venues.map(v => v.id) } }, orderBy: { id: "asc" } });
  const term = termFor(version.semester);
  const context: ValidationContext = {
    teachings: Object.fromEntries(teachings.map(t => [t.id,{ lecturerId: t.lecturerId, groupId: t.groupId, expectedSize: t.expectedSize, venueTypeRequired: t.unit.venueTypeRequired, unitCode: t.unit.code }])),
    venues: Object.fromEntries(venues.map(v => [v.id,{ code: v.code, capacity: v.capacity, type: v.type }])),
    lecturerUnavailable: Object.fromEntries(teachings.map(t => [t.lecturerId, lecturerUnavailable.filter(a => a.lecturerId === t.lecturerId && !a.available).map(a => ({ id: a.id, day: DaySchema.parse(a.day), start: a.start, end: a.end }))])),
    venueUnavailable: Object.fromEntries(venues.map(v => [v.id, venueUnavailable.filter(a => a.venueId === v.id).map(a => ({ day: a.day, start: a.start, end: a.end }))])),
  };
  const data = { version, entries, exceptions, teachings, venues, lecturerUnavailable, venueUnavailable, term, policy: DEFAULT_POLICY };
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return { ...data, context, fingerprint };
}
export type M6Snapshot = Awaited<ReturnType<typeof readM6Snapshot>>;
export function assessSnapshot(s: M6Snapshot, entries = s.entries, exceptions = s.exceptions) {
  const result = assessCandidate(entries, exceptions, s.context, s.term);
  const invalidContext = s.teachings.some(t => t.unit.semester !== s.version.semester || !t.unit.scheduled) || [...s.lecturerUnavailable,...s.venueUnavailable].some(a => !["MON","TUE","WED","THU","FRI"].includes(a.day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.end) || a.start >= a.end);
  const closed = s.venues.filter(v => v.status !== "ACTIVE");
  return { ...result, status: invalidContext ? "INCOMPLETE" as const : closed.length ? "CONFLICTED" as const : result.status,
    operationalProblems: closed.map(v => `${v.code} is ${v.status}; repair the draft before publication.`) };
}
