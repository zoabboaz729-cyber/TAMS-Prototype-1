import type { Actor } from "./permissions";
import { canAct } from "./permissions";
import {
  availableSubmissionActions,
  type SubmissionAction,
} from "./submissionRules";
import { SubmissionStatusSchema, type SubmissionStatus } from "./types";
import type { DepartmentRef } from "./venueRegister";

export type SubmissionRecord = {
  id: string;
  departmentId: string;
  semester: number;
  status: string;
  note: string | null;
  reviewerName: string | null;
};

export type SubmissionView = "EDIT" | "REVIEW" | "OVERVIEW";

export type SubmissionRow = {
  id: string;
  departmentId: string;
  departmentName: string;
  semester: number;
  semesterLabel: string;
  status: SubmissionStatus;
  statusLabel: string;
  statusTone: "neutral" | "info" | "warning" | "success";
  note: string | null;
  reviewerName: string | null;
  actions: SubmissionAction[];
};

export type TeachingRecord = {
  id: string;
  expectedSize: number;
  sessionsPerWeek: number;
  sessionLength: number;
  unitCode: string;
  unitTitle: string;
  lecturerName: string;
  groupName: string;
};

function statusPresentation(status: SubmissionStatus): {
  label: string;
  tone: SubmissionRow["statusTone"];
} {
  switch (status) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    case "SUBMITTED":
      return { label: "Awaiting approval", tone: "info" };
    case "RETURNED":
      return { label: "Returned for changes", tone: "warning" };
    case "APPROVED":
      return { label: "Approved", tone: "success" };
  }
}

function actionForView(view: SubmissionView): Parameters<typeof canAct>[1] | null {
  switch (view) {
    case "EDIT":
      return "EDIT_SUBMISSION";
    case "REVIEW":
      return "REVIEW_SUBMISSION";
    case "OVERVIEW":
      return "VIEW_SUBMISSIONS";
    default:
      return null;
  }
}

export function buildSubmissionRows(
  records: SubmissionRecord[],
  departments: DepartmentRef[],
  actor: Actor | null,
  view: SubmissionView,
): SubmissionRow[] {
  const permission = actionForView(view);
  if (actor === null || permission === null) return [];

  return records
    .flatMap((record) => {
      const parsedStatus = SubmissionStatusSchema.safeParse(record.status);
      if (
        !parsedStatus.success ||
        !canAct(actor, permission, { departmentId: record.departmentId })
      ) {
        return [];
      }

      const status = parsedStatus.data;
      const department = departments.find(
        (candidate) => candidate.id === record.departmentId,
      );
      const presentation = statusPresentation(status);
      let actions: SubmissionAction[] = [];

      if (view === "EDIT") {
        actions = availableSubmissionActions(actor, {
          departmentId: record.departmentId,
          status,
        }).filter((action) => action === "SUBMIT");
      } else if (view === "REVIEW") {
        actions = availableSubmissionActions(actor, {
          departmentId: record.departmentId,
          status,
        }).filter((action) => action === "APPROVE" || action === "RETURN");
      }

      return [{
        id: record.id,
        departmentId: record.departmentId,
        departmentName: department?.name ?? "Unknown department",
        semester: record.semester,
        semesterLabel: `Semester ${record.semester}`,
        status,
        statusLabel: presentation.label,
        statusTone: presentation.tone,
        note: record.note,
        reviewerName: record.reviewerName,
        actions,
      }];
    })
    .sort((left, right) =>
      left.departmentName < right.departmentName
        ? -1
        : left.departmentName > right.departmentName
          ? 1
          : left.semester < right.semester
            ? -1
            : left.semester > right.semester
              ? 1
              : 0,
    );
}

export type SubmissionNotice = {
  type: "success" | "info" | "warning";
  message: string;
};

const SUBMISSION_NOTICES: Record<string, SubmissionNotice> = {
  submitted: {
    type: "success",
    message: "Submission sent for review.",
  },
  approved: {
    type: "success",
    message: "Submission approved.",
  },
  returned: {
    type: "info",
    message: "Submission returned to the department.",
  },
  conflict: {
    type: "warning",
    message:
      "Someone else changed this submission first. Please check it and try again.",
  },
  invalid_state: {
    type: "warning",
    message:
      "That action is not available for the submission's current status.",
  },
  not_found: {
    type: "warning",
    message: "That submission could not be found.",
  },
};

export function submissionNoticeFor(value: unknown): SubmissionNotice | null {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(SUBMISSION_NOTICES, value)
  ) {
    return null;
  }
  return { ...SUBMISSION_NOTICES[value] };
}

export function summariseTeaching(
  records: Pick<TeachingRecord, "sessionsPerWeek" | "sessionLength">[],
): { count: number; hoursPerWeek: number } {
  return {
    count: records.length,
    hoursPerWeek: records.reduce(
      (total, record) =>
        total + record.sessionsPerWeek * record.sessionLength,
      0,
    ),
  };
}
