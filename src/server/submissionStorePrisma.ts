import { Prisma } from "@prisma/client";
import { SubmissionStatusSchema } from "../domain/types";
import { prisma } from "./db";
import type { SubmissionStore, StoredSubmission, SubmissionAuditDraft, SubmissionUpdate } from "./submissionWrite";

export function createPrismaSubmissionStore(): SubmissionStore {
  return {
    async findSubmission(id: string): Promise<StoredSubmission | null> {
      const row = await prisma.submission.findUnique({
        where: { id },
        select: {
          id: true,
          departmentId: true,
          semester: true,
          status: true,
          note: true,
          reviewerId: true,
        },
      });

      if (row === null) return null;
      const parsed = SubmissionStatusSchema.safeParse(row.status);
      if (!parsed.success) {
        console.error("[submissions] invalid stored status for", id);
        return null;
      }

      return {
        id: row.id,
        departmentId: row.departmentId,
        semester: row.semester,
        status: parsed.data,
        note: row.note,
        reviewerId: row.reviewerId,
      };
    },

    async applyTransition(
      id: string,
      expectedStatus: string,
      update: SubmissionUpdate,
      audit: SubmissionAuditDraft,
    ) {
      return await prisma.$transaction(async (tx) => {
        const result = await tx.submission.updateMany({
          where: {
            id,
            status: expectedStatus,
          },
          data: {
            status: update.status,
            note: update.note,
            reviewerId: update.reviewerId,
          },
        });

        if (result.count === 0) {
          const existing = await tx.submission.findUnique({
            where: { id },
            select: { id: true },
          });
          if (existing === null) {
            return { notFound: true } as const;
          }
          return { stale: true } as const;
        }

        await tx.auditLog.create({
          data: {
            actorId: audit.actorId,
            action: audit.action,
            entity: "Submission",
            entityId: id,
            reason: audit.reason,
          },
        });

        return { ok: true } as const;
      });
    },
  };
}
