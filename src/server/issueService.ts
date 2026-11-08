import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canAct, type Actor } from "@/domain/permissions";
import { IssueSubmitSchema, IssueUpdateSchema, issueTransition } from "@/domain/issueRules";
import { ensure, m6Result } from "./m6Errors";
export function createIssue(client: PrismaClient, actor: Actor | null, input: unknown) {
  return m6Result(async () => { ensure(actor,"UNAUTHENTICATED"); ensure(["DEPT_REP","APPROVER","LECTURER"].includes(actor.role),"FORBIDDEN"); ensure(actor.departmentId,"IDENTITY_UNRESOLVED"); ensure(canAct(actor,"REPORT_ISSUE",{ departmentId: actor.departmentId }),"FORBIDDEN");
    const p = IssueSubmitSchema.safeParse(input); ensure(p.success,"INVALID_INPUT");
    return client.$transaction(async tx => {
      if (p.data.venueId) ensure(await tx.venue.findUnique({ where: { id: p.data.venueId } }),"INVALID_INPUT");
      const issue = await tx.issue.create({ data: { text: p.data.text, venueId: p.data.venueId ?? null, departmentId: actor.departmentId!, reportedBy: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "ISSUE_REPORTED", entity: "Issue", entityId: issue.id, reason: "Created OPEN" } }); return { issueId: issue.id, status: issue.status };
    });
  });
}
export function updateIssue(client: PrismaClient, actor: Actor | null, input: unknown) {
  return m6Result(async () => { ensure(actor,"UNAUTHENTICATED"); ensure(canAct(actor,"UPDATE_ISSUE_STATUS"),"FORBIDDEN"); const p = IssueUpdateSchema.safeParse(input); ensure(p.success,"INVALID_INPUT"); const d = p.data;
    return client.$transaction(async tx => {
      const issue = await tx.issue.findUnique({ where: { id: d.issueId } }); ensure(issue,"SOURCE_NOT_FOUND"); ensure(issue.status === d.expectedStatus,"STALE"); const problem = issueTransition(issue.status,d.nextStatus,d.note); ensure(!problem,problem ?? "INVALID_INPUT");
      const changed = await tx.issue.updateMany({ where: { id: issue.id, status: d.expectedStatus }, data: { status: d.nextStatus } }); ensure(changed.count === 1,"STALE");
      const action = d.nextStatus === "IN_PROGRESS" ? issue.status === "RESOLVED" ? "ISSUE_REOPENED" : "ISSUE_IN_PROGRESS" : `ISSUE_${d.nextStatus}`;
      await tx.auditLog.create({ data: { actorId: actor.id, action, entity: "Issue", entityId: issue.id, reason: `${issue.status} -> ${d.nextStatus}: ${d.note ?? ""}` } }); return { issueId: issue.id, status: d.nextStatus };
    });
  });
}
export function listIssues(client: PrismaClient, actor: Actor | null, input: unknown) {
  return m6Result(async () => { ensure(actor,"UNAUTHENTICATED"); ensure(["OFFICER","DEPT_REP","APPROVER"].includes(actor.role),"FORBIDDEN"); if (actor.role !== "OFFICER") ensure(actor.departmentId,"IDENTITY_UNRESOLVED");
    const p = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0), status: z.enum(["OPEN","IN_PROGRESS","RESOLVED","CLOSED"]).optional() }).strict().safeParse(input); ensure(p.success,"INVALID_INPUT");
    const rows = await client.issue.findMany({ where: { ...(actor.role !== "OFFICER" ? { departmentId: actor.departmentId! } : {}), ...(p.data.status ? { status: p.data.status } : {}) }, orderBy: [{ createdAt: "desc" },{ id: "desc" }], skip: p.data.page * 25, take: 25 });
    ensure(rows.every(r => canAct(actor,"SEE_ISSUES",{ departmentId: r.departmentId })),"FORBIDDEN"); return rows;
  });
}
