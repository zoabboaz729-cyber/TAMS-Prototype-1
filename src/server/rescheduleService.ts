import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, RescheduleRequest } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { RescheduleSubmitSchema, RescheduleDecisionSchema, proposalProblem } from "@/domain/rescheduleRules";
import { weekday } from "@/domain/termCalendar";
import { ensure, m6Result } from "./m6Errors";
import { readM6Snapshot, assessSnapshot, type M6Client, type M6Snapshot } from "./m6Snapshot";
function authorize(actor: Actor | null, role: "LECTURER" | "OFFICER"): asserts actor is Actor { ensure(actor,"UNAUTHENTICATED"); ensure(actor.role === role,"FORBIDDEN"); }
async function current(tx: M6Client, s: M6Snapshot) {
  const pubs = await tx.timetableVersion.findMany({ where: { semester: s.version.semester, status: "PUBLISHED" } });
  ensure(pubs.length,"NO_PUBLICATION"); ensure(pubs.length === 1,"AMBIGUOUS_PUBLICATION");
  ensure(pubs[0].id === s.version.id && s.version.publishedAt,"STALE_SOURCE");
}
function proposal(r: RescheduleRequest) {
  const common = { sourceEntryId: r.entryId, proposedStart: r.proposedStart, proposedEnd: r.proposedEnd, reason: r.reason };
  return RescheduleSubmitSchema.parse(r.kind === "WEEKLY" ? { ...common, kind: r.kind, proposedDay: r.proposedDay } : { ...common, kind: r.kind, originalDate: r.originalDate, replacementDate: r.replacementDate });
}
async function candidate(tx: M6Client, requestId: string, now: Date) {
  const r = await tx.rescheduleRequest.findUnique({ where: { id: requestId }, include: { entry: true } });
  ensure(r,"SOURCE_NOT_FOUND"); ensure(r.status === "PENDING" && r.pendingKey === r.entryId,"NOT_PENDING");
  const s = await readM6Snapshot(tx,r.entry.versionId); await current(tx,s);
  const owner = s.teachings.find(t => t.id === r.entry.teachingId)?.lecturer.userId;
  ensure(owner && owner === r.requestedBy,"INVALID_STORED_DATA");
  const p = proposal(r), problem = proposalProblem(p,r.entry,s.exceptions,s.term,now); ensure(!problem,problem ?? "INVALID_INPUT");
  const entries = s.entries.map(e => p.kind === "WEEKLY" && e.id === r.entryId ? { ...e, day: p.proposedDay, start: p.proposedStart, end: p.proposedEnd } : e);
  const exceptions = p.kind === "ONE_OFF" ? [...s.exceptions, { id: "candidate", versionId: s.version.id, entryId: r.entryId, originalDate: p.originalDate, replacementDate: p.replacementDate, replacementStart: p.proposedStart, replacementEnd: p.proposedEnd, createdAt: now }] : s.exceptions;
  const baseline = assessSnapshot(s), assessment = assessSnapshot(s,entries,exceptions);
  const token = createHash("sha256").update(JSON.stringify([s.fingerprint,r])).digest("hex");
  return { r,s,p,entries,exceptions,baseline,assessment,token };
}
export function submitReschedule(client: PrismaClient, actor: Actor | null, input: unknown, now: Date) {
  return m6Result(async () => {
    authorize(actor,"LECTURER"); const parsed = RescheduleSubmitSchema.safeParse(input); ensure(parsed.success,"INVALID_INPUT"); const p = parsed.data;
    return client.$transaction(async tx => {
      const source = await tx.timetableEntry.findFirst({ where: { id: p.sourceEntryId, teaching: { lecturer: { userId: actor.id } } } });
      ensure(source,"SOURCE_NOT_FOUND"); const s = await readM6Snapshot(tx,source.versionId); await current(tx,s);
      const problem = proposalProblem(p,source,s.exceptions,s.term,now); ensure(!problem,problem ?? "INVALID_INPUT");
      const r = await tx.rescheduleRequest.create({ data: { entryId: source.id, requestedBy: actor.id, kind: p.kind, proposedDay: p.kind === "WEEKLY" ? p.proposedDay : weekday(p.replacementDate), proposedStart: p.proposedStart, proposedEnd: p.proposedEnd, originalDate: p.kind === "ONE_OFF" ? p.originalDate : null, replacementDate: p.kind === "ONE_OFF" ? p.replacementDate : null, pendingKey: source.id, reason: p.reason } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_REQUESTED", entity: "RescheduleRequest", entityId: r.id, reason: p.kind } });
      return { requestId: r.id, status: r.status };
    });
  });
}
export function reviewReschedule(client: PrismaClient, actor: Actor | null, requestId: string, now: Date) {
  return m6Result(async () => { authorize(actor,"OFFICER"); ensure(z.string().min(1).max(100).safeParse(requestId).success,"INVALID_INPUT");
    return client.$transaction(async tx => { const c = await candidate(tx,requestId,now); return { token: c.token, assessment: c.assessment, baseline: c.baseline }; });
  });
}
export function decideReschedule(client: PrismaClient, actor: Actor | null, input: unknown, now: Date) {
  return m6Result(async () => { authorize(actor,"OFFICER"); const parsed = RescheduleDecisionSchema.safeParse(input); ensure(parsed.success,"INVALID_INPUT"); const d = parsed.data;
    return client.$transaction(async tx => {
      const c = await candidate(tx,d.requestId,now); ensure(c.token === d.expectedReviewToken,"STALE");
      if (d.decision === "REJECT") {
        ensure(d.note.length >= 10,"NOTE_REQUIRED");
        const changed = await tx.rescheduleRequest.updateMany({ where: { id: c.r.id, status: "PENDING", pendingKey: c.r.entryId }, data: { status: "REJECTED", pendingKey: null, decisionNote: d.note } }); ensure(changed.count === 1,"NOT_PENDING");
        await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_REJECTED", entity: "RescheduleRequest", entityId: c.r.id, reason: d.note } });
        return { status: "REJECTED", draftId: null, requiresRepair: false };
      }
      ensure(c.assessment.status !== "INCOMPLETE","INCOMPLETE_VALIDATION");
      if (c.assessment.status === "CONFLICTED") { ensure(d.override,"CONFLICTS_REQUIRE_OVERRIDE"); ensure(d.note.length >= 10,"NOTE_REQUIRED"); }
      if (d.override) ensure(d.note.length >= 10,"NOTE_REQUIRED");
      const draft = await tx.timetableVersion.create({ data: { semester: c.s.version.semester, createdBy: actor.id, basePublishedVersionId: c.s.version.id } });
      const mapping = new Map<string,string>();
      for (const e of c.entries) {
        const copy = await tx.timetableEntry.create({ data: { versionId: draft.id, teachingId: e.teachingId, venueId: e.venueId, day: e.day, start: e.start, end: e.end, locked: e.locked } }); mapping.set(e.id,copy.id);
        await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_ENTRY_COPY", entity: "TimetableEntry", entityId: copy.id, reason: e.id } });
      }
      for (const x of c.exceptions) {
        const copy = await tx.timetableOccurrenceException.create({ data: { versionId: draft.id, entryId: mapping.get(x.entryId)!, originalDate: x.originalDate, replacementDate: x.replacementDate, replacementStart: x.replacementStart, replacementEnd: x.replacementEnd } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_EXCEPTION_COPY", entity: "TimetableOccurrenceException", entityId: copy.id, reason: x.entryId } });
      }
      const changed = await tx.rescheduleRequest.updateMany({ where: { id: c.r.id, status: "PENDING", pendingKey: c.r.entryId }, data: { status: "APPROVED", pendingKey: null, resultDraftVersionId: draft.id, decisionNote: d.note || null } }); ensure(changed.count === 1,"NOT_PENDING");
      await tx.auditLog.create({ data: { actorId: actor.id, action: d.override ? "RESCHEDULE_OVERRIDE_APPROVED" : "RESCHEDULE_APPROVED", entity: "RescheduleRequest", entityId: c.r.id, reason: d.note || "Approved creation of draft only" } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_DRAFT_CREATED", entity: "TimetableVersion", entityId: draft.id, reason: c.r.id } });
      return { status: "APPROVED", draftId: draft.id, requiresRepair: c.assessment.status === "CONFLICTED" };
    });
  });
}
export function cancelReschedule(client: PrismaClient, actor: Actor | null, input: unknown) {
  return m6Result(async () => { authorize(actor,"LECTURER"); const parsed = z.object({ requestId: z.string().min(1).max(100) }).strict().safeParse(input); ensure(parsed.success,"INVALID_INPUT");
    return client.$transaction(async tx => {
      const r = await tx.rescheduleRequest.findFirst({ where: { id: parsed.data.requestId, requestedBy: actor.id } }); ensure(r,"SOURCE_NOT_FOUND"); ensure(r.status === "PENDING","NOT_PENDING");
      const changed = await tx.rescheduleRequest.updateMany({ where: { id: r.id, requestedBy: actor.id, status: "PENDING" }, data: { status: "CANCELLED", pendingKey: null } }); ensure(changed.count === 1,"NOT_PENDING");
      await tx.auditLog.create({ data: { actorId: actor.id, action: "RESCHEDULE_CANCELLED", entity: "RescheduleRequest", entityId: r.id } }); return { requestId: r.id };
    });
  });
}
