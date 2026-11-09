import type { Prisma } from "@prisma/client";
import { OccurrenceRef, scheduledInstant } from "@/domain/attendanceRules";
import { canAct, type Actor, type Action } from "@/domain/permissions";
import { materializeDate } from "@/domain/occurrences";
import { inTerm, weekday } from "@/domain/termCalendar";
import { readM6Snapshot } from "./m6Snapshot";
import { refuse } from "./attendanceErrors";
export type AttendanceTx = Prisma.TransactionClient;
export async function attendanceActor(tx: AttendanceTx, actor: Actor | null) {
  if (!actor?.id) refuse("UNAUTHENTICATED");
  const user = await tx.user.findUnique({where:{id:actor.id}});
  if (!user || user.role !== actor.role) refuse("FORBIDDEN");
  return { ...user, role: actor.role };
}
export async function resolveAttendanceOccurrence(tx: AttendanceTx, input: unknown) {
  const parsed = OccurrenceRef.safeParse(input); if(!parsed.success) refuse("INVALID_INPUT");
  const ref = parsed.data;
  const entry = await tx.timetableEntry.findUnique({where:{id:ref.sourceEntryId},include:{version:true, teaching:{include:{unit:true,lecturer:true,group:true}},venue:true}});
  if(!entry) refuse("NOT_FOUND");
  if(entry.version.status !== "PUBLISHED" || !entry.version.publishedAt) refuse("STALE_PUBLICATION");
  const current = await tx.timetableVersion.findMany({where:{semester:entry.version.semester,status:"PUBLISHED"}});
  if(current.length !== 1 || current[0].id !== entry.versionId) refuse("STALE_PUBLICATION");
  const snapshot = await readM6Snapshot(tx,entry.versionId);
  if(!snapshot.term) refuse("TERM_NOT_CONFIGURED");
  if(!inTerm(ref.originalDate,snapshot.term) || weekday(ref.originalDate)!==entry.day) refuse("OCCURRENCE_NOT_EFFECTIVE");
  if(entry.teaching.unit.semester !== entry.version.semester || !entry.teaching.unit.scheduled) refuse("INVALID_STORED_DATA");
  const change = snapshot.exceptions.find(x=>x.entryId===entry.id && x.originalDate===ref.originalDate);
  const actualDate = change?.replacementDate ?? ref.originalDate;
  let occurrences;
  try { occurrences = materializeDate(snapshot.entries,snapshot.exceptions,actualDate,snapshot.term); } catch { refuse("INVALID_STORED_DATA"); }
  const matches = occurrences.filter(x=>x.sourceEntryId===entry.id && x.originalDate===ref.originalDate);
  if(matches.length!==1) refuse("OCCURRENCE_NOT_EFFECTIVE");
  const o=matches[0];
  return {entry, occurrence:o, starts:scheduledInstant(o.actualDate,o.actualStart), ends:scheduledInstant(o.actualDate,o.actualEnd), snapshot};
}
export type ResolvedAttendance = Awaited<ReturnType<typeof resolveAttendanceOccurrence>>;
export function authorizeOccurrence(actor: Actor, action: Action, r: ResolvedAttendance) {
  if(!canAct(actor,action,{ownerUserId:r.entry.teaching.lecturer.userId,groupId:r.entry.teaching.groupId,departmentId:r.entry.teaching.group.departmentId,subjectUserId:actor.id})) refuse("FORBIDDEN");
}
export function operationalAttendance(r: ResolvedAttendance) {
  const o=r.occurrence;
  if(r.entry.venue.status!=="ACTIVE" || r.snapshot.venueUnavailable.some(x=>x.venueId===r.entry.venueId && x.day===o.day && x.start<o.actualEnd && o.actualStart<x.end)) refuse("VENUE_UNAVAILABLE");
}
