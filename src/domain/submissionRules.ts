import { canAct, type Actor } from "./permissions";
import type { SubmissionStatus } from "./types";

export const SUBMISSION_ACTIONS = ["SUBMIT", "APPROVE", "RETURN"] as const;
export type SubmissionAction = (typeof SUBMISSION_ACTIONS)[number];

export const NOTE_MIN_FOR_RETURN = 3;
export const NOTE_MAX = 500;

export type SubmissionSnapshot = {
  departmentId: string;
  status: SubmissionStatus;
};

export type SubmissionDecision =
  | { status: "ALLOW"; nextStatus: SubmissionStatus; note: string | null }
  | { status: "UNAUTHENTICATED" }
  | { status: "FORBIDDEN" }
  | { status: "INVALID_STATE" }
  | { status: "NOTE_REQUIRED" }
  | { status: "NOTE_TOO_LONG" };

export function decideSubmissionTransition(
  actor: Actor | null,
  submission: SubmissionSnapshot,
  action: SubmissionAction,
  note?: string | null,
): SubmissionDecision {
  if (actor === null) {
    return { status: "UNAUTHENTICATED" };
  }

  if (!SUBMISSION_ACTIONS.includes(action)) {
    return { status: "FORBIDDEN" };
  }

  const permission =
    action === "SUBMIT" ? "EDIT_SUBMISSION" : "REVIEW_SUBMISSION";
  if (!canAct(actor, permission, { departmentId: submission.departmentId })) {
    return { status: "FORBIDDEN" };
  }

  let nextStatus: SubmissionStatus;
  if (action === "SUBMIT" && (submission.status === "DRAFT" || submission.status === "RETURNED")) {
    nextStatus = "SUBMITTED";
  } else if (action === "APPROVE" && submission.status === "SUBMITTED") {
    nextStatus = "APPROVED";
  } else if (action === "RETURN" && submission.status === "SUBMITTED") {
    nextStatus = "RETURNED";
  } else {
    return { status: "INVALID_STATE" };
  }

  const trimmedNote = note?.trim() || null;
  if (trimmedNote !== null && trimmedNote.length > NOTE_MAX) {
    return { status: "NOTE_TOO_LONG" };
  }
  if (
    action === "RETURN" &&
    (trimmedNote === null || trimmedNote.length < NOTE_MIN_FOR_RETURN)
  ) {
    return { status: "NOTE_REQUIRED" };
  }

  return { status: "ALLOW", nextStatus, note: trimmedNote };
}

export function availableSubmissionActions(
  actor: Actor | null,
  submission: SubmissionSnapshot,
): SubmissionAction[] {
  return SUBMISSION_ACTIONS.filter(
    (action) =>
      decideSubmissionTransition(actor, submission, action, "valid note").status ===
      "ALLOW",
  );
}

export function submissionAuditReason(
  action: SubmissionAction,
  from: SubmissionStatus,
  to: SubmissionStatus,
  note: string | null,
): string {
  const base = `${action.toLowerCase()}: ${from} -> ${to}`;
  return note === null ? base : `${base} | note: ${note.slice(0, 200)}`;
}
