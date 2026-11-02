import { decideAnyAccess } from "../domain/access";
import type { Actor } from "../domain/permissions";
import {
  decideSubmissionTransition,
  submissionAuditReason,
  type SubmissionAction,
} from "../domain/submissionRules";
import type { SubmissionStatus } from "../domain/types";

export type StoredSubmission = {
  id: string;
  departmentId: string;
  semester: number;
  status: SubmissionStatus;
  note: string | null;
  reviewerId: string | null;
};

export type SubmissionAuditDraft = {
  actorId: string;
  action: "SUBMISSION_SUBMIT" | "SUBMISSION_APPROVE" | "SUBMISSION_RETURN";
  reason: string;
};

export type SubmissionUpdate = {
  status: SubmissionStatus;
  note: string | null;
  reviewerId: string | null;
};

export interface SubmissionStore {
  findSubmission(id: string): Promise<StoredSubmission | null>;
  applyTransition(
    id: string,
    expectedStatus: SubmissionStatus,
    update: SubmissionUpdate,
    audit: SubmissionAuditDraft,
  ): Promise<{ ok: true } | { stale: true } | { notFound: true }>;
}

export type SubmissionWriteRequest = {
  submissionId: string;
  action: SubmissionAction;
  note?: string | null;
};

export type SubmissionWriteResult =
  | { ok: true; submissionId: string; status: SubmissionStatus }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE" | "CONFLICT" }
  | { ok: false; kind: "VALIDATION"; reason: "NOTE_REQUIRED" | "NOTE_TOO_LONG"; message: string };

export async function performSubmissionWrite(
  store: SubmissionStore,
  actor: Actor | null,
  request: SubmissionWriteRequest,
): Promise<SubmissionWriteResult> {
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  const action = request.action;
  if (action !== "SUBMIT" && action !== "APPROVE" && action !== "RETURN") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const permission = action === "SUBMIT" ? "EDIT_SUBMISSION" : "REVIEW_SUBMISSION";
  const anyAccess = decideAnyAccess(actor, permission);
  if (anyAccess.status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const current = await store.findSubmission(request.submissionId);
  if (current === null) {
    return { ok: false, kind: "NOT_FOUND" };
  }

  const decision = decideSubmissionTransition(
    actor,
    { departmentId: current.departmentId, status: current.status },
    request.action,
    request.note,
  );

  if (decision.status === "UNAUTHENTICATED") {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }
  if (decision.status === "FORBIDDEN") {
    return { ok: false, kind: "FORBIDDEN" };
  }
  if (decision.status === "INVALID_STATE") {
    return { ok: false, kind: "INVALID_STATE" };
  }
  if (decision.status === "NOTE_REQUIRED") {
    return {
      ok: false,
      kind: "VALIDATION",
      reason: "NOTE_REQUIRED",
      message: "Please give a reason of at least 3 characters when returning a submission",
    };
  }
  if (decision.status === "NOTE_TOO_LONG") {
    return {
      ok: false,
      kind: "VALIDATION",
      reason: "NOTE_TOO_LONG",
      message: "The note is too long (500 characters at most)",
    };
  }

  const update: SubmissionUpdate = {
    status: decision.nextStatus,
    note: decision.note,
    reviewerId: action === "SUBMIT" ? null : actor.id,
  };

  const audit: SubmissionAuditDraft = {
    actorId: actor.id,
    action:
      action === "SUBMIT"
        ? "SUBMISSION_SUBMIT"
        : action === "APPROVE"
          ? "SUBMISSION_APPROVE"
          : "SUBMISSION_RETURN",
    reason: submissionAuditReason(request.action, current.status, decision.nextStatus, decision.note),
  };

  const result = await store.applyTransition(current.id, current.status, update, audit);
  if ("ok" in result) {
    return { ok: true, submissionId: current.id, status: decision.nextStatus };
  }
  if ("stale" in result) {
    return { ok: false, kind: "CONFLICT" };
  }
  return { ok: false, kind: "NOT_FOUND" };
}
