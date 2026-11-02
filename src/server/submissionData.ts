import "server-only";
import type {
  SubmissionRecord,
  TeachingRecord,
} from "@/domain/submissionView";
import { prisma } from "./db";

export async function loadSubmissionRecords(): Promise<SubmissionRecord[]> {
  const submissions = await prisma.submission.findMany({
    select: {
      id: true,
      departmentId: true,
      semester: true,
      status: true,
      note: true,
      reviewer: {
        select: {
          name: true,
        },
      },
    },
  });

  return submissions.map((submission) => ({
    id: submission.id,
    departmentId: submission.departmentId,
    semester: submission.semester,
    status: submission.status,
    note: submission.note,
    reviewerName: submission.reviewer?.name ?? null,
  }));
}

export async function loadTeachingRecords(
  departmentId: string,
  semester: number,
): Promise<TeachingRecord[]> {
  const teachings = await prisma.teaching.findMany({
    where: {
      unit: {
        is: {
          departmentId,
          semester,
          scheduled: true,
        },
      },
    },
    select: {
      id: true,
      expectedSize: true,
      sessionsPerWeek: true,
      sessionLength: true,
      unit: {
        select: {
          code: true,
          title: true,
        },
      },
      lecturer: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
      group: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { unit: { code: "asc" } },
      { group: { name: "asc" } },
    ],
  });

  return teachings.map((teaching) => ({
    id: teaching.id,
    expectedSize: teaching.expectedSize,
    sessionsPerWeek: teaching.sessionsPerWeek,
    sessionLength: teaching.sessionLength,
    unitCode: teaching.unit.code,
    unitTitle: teaching.unit.title,
    lecturerName: teaching.lecturer.user.name,
    groupName: teaching.group.name,
  }));
}
