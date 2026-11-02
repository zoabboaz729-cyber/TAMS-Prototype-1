import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import {
  availableSubmissionActions,
  decideSubmissionTransition,
  NOTE_MAX,
  NOTE_MIN_FOR_RETURN,
  SUBMISSION_ACTIONS,
  submissionAuditReason,
  type SubmissionAction,
  type SubmissionSnapshot,
} from "../submissionRules";
import type { SubmissionStatus, UserRole } from "../types";

const computingRep: Actor = {
  id: "u-computing-rep",
  role: "DEPT_REP",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsRep: Actor = {
  id: "u-mathematics-rep",
  role: "DEPT_REP",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const computingApprover: Actor = {
  id: "u-computing-approver",
  role: "APPROVER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsApprover: Actor = {
  id: "u-mathematics-approver",
  role: "APPROVER",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const officer: Actor = {
  id: "u-officer",
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};
const admin: Actor = {
  id: "u-admin",
  role: "ADMIN",
  departmentId: null,
  studentGroupId: null,
};
const lecturer: Actor = {
  id: "u-lecturer",
  role: "LECTURER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const student: Actor = {
  id: "u-student",
  role: "STUDENT",
  departmentId: null,
  studentGroupId: "group-se-y4",
};
const repWithoutDepartment: Actor = {
  id: "u-rep-no-department",
  role: "DEPT_REP",
  departmentId: null,
  studentGroupId: null,
};
const approverWithoutDepartment: Actor = {
  id: "u-approver-no-department",
  role: "APPROVER",
  departmentId: null,
  studentGroupId: null,
};

const states: SubmissionStatus[] = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"];
const submissionFor = (status: SubmissionStatus): SubmissionSnapshot => ({
  departmentId: "dept-computing",
  status,
});

describe("decideSubmissionTransition", () => {
  it("SUBMIT: computing rep may submit DRAFT and RETURNED, but not SUBMITTED or APPROVED", () => {
    expect(decideSubmissionTransition(computingRep, submissionFor("DRAFT"), "SUBMIT")).toEqual({
      status: "ALLOW",
      nextStatus: "SUBMITTED",
      note: null,
    });
    expect(decideSubmissionTransition(computingRep, submissionFor("RETURNED"), "SUBMIT")).toEqual({
      status: "ALLOW",
      nextStatus: "SUBMITTED",
      note: null,
    });
    expect(decideSubmissionTransition(computingRep, submissionFor("SUBMITTED"), "SUBMIT")).toEqual({
      status: "INVALID_STATE",
    });
    expect(decideSubmissionTransition(computingRep, submissionFor("APPROVED"), "SUBMIT")).toEqual({
      status: "INVALID_STATE",
    });
  });

  it("SUBMIT: maths rep is FORBIDDEN on a computing submission in every state", () => {
    for (const state of states) {
      expect(decideSubmissionTransition(mathsRep, submissionFor(state), "SUBMIT")).toEqual({
        status: "FORBIDDEN",
      });
    }
  });

  it("SUBMIT: approvers, officer, admin, lecturer, student, and null-department rep are FORBIDDEN in every state", () => {
    const forbiddenActors = [
      computingApprover,
      mathsApprover,
      officer,
      admin,
      lecturer,
      student,
      repWithoutDepartment,
    ];
    for (const actor of forbiddenActors) {
      for (const state of states) {
        expect(decideSubmissionTransition(actor, submissionFor(state), "SUBMIT")).toEqual({
          status: "FORBIDDEN",
        });
      }
    }
  });

  it("SUBMIT: null actor is UNAUTHENTICATED in every state", () => {
    for (const state of states) {
      expect(decideSubmissionTransition(null, submissionFor(state), "SUBMIT")).toEqual({
        status: "UNAUTHENTICATED",
      });
    }
  });

  it("APPROVE: computing approver may approve SUBMITTED only", () => {
    expect(
      decideSubmissionTransition(computingApprover, submissionFor("SUBMITTED"), "APPROVE"),
    ).toEqual({ status: "ALLOW", nextStatus: "APPROVED", note: null });
    for (const state of ["DRAFT", "RETURNED", "APPROVED"] as const) {
      expect(
        decideSubmissionTransition(computingApprover, submissionFor(state), "APPROVE"),
      ).toEqual({ status: "INVALID_STATE" });
    }
  });

  it("APPROVE: maths approver is FORBIDDEN on a computing submission in every state", () => {
    for (const state of states) {
      expect(decideSubmissionTransition(mathsApprover, submissionFor(state), "APPROVE")).toEqual({
        status: "FORBIDDEN",
      });
    }
  });

  it("APPROVE: reps, officer, admin, lecturer, student, and null-department approver are FORBIDDEN in every state", () => {
    const forbiddenActors = [
      computingRep,
      officer,
      admin,
      lecturer,
      student,
      approverWithoutDepartment,
    ];
    for (const actor of forbiddenActors) {
      for (const state of states) {
        expect(decideSubmissionTransition(actor, submissionFor(state), "APPROVE")).toEqual({
          status: "FORBIDDEN",
        });
      }
    }
  });

  it("RETURN: computing approver can return SUBMITTED with a trimmed note", () => {
    expect(
      decideSubmissionTransition(
        computingApprover,
        submissionFor("SUBMITTED"),
        "RETURN",
        "Please add the missing lecturer",
      ),
    ).toEqual({
      status: "ALLOW",
      nextStatus: "RETURNED",
      note: "Please add the missing lecturer",
    });
    expect(
      decideSubmissionTransition(
        computingApprover,
        submissionFor("SUBMITTED"),
        "RETURN",
        "  fix list  ",
      ),
    ).toEqual({ status: "ALLOW", nextStatus: "RETURNED", note: "fix list" });
    expect(NOTE_MIN_FOR_RETURN).toBe(3);
  });

  it("RETURN: missing or too-short notes are NOTE_REQUIRED", () => {
    for (const note of [undefined, null, "", "   ", "ab"] as const) {
      expect(
        decideSubmissionTransition(computingApprover, submissionFor("SUBMITTED"), "RETURN", note),
      ).toEqual({ status: "NOTE_REQUIRED" });
    }
  });

  it("non-string notes are treated as absent without throwing", () => {
    const numericNote = 123 as never;
    expect(() =>
      decideSubmissionTransition(computingRep, submissionFor("DRAFT"), "SUBMIT", numericNote),
    ).not.toThrow();
    expect(
      decideSubmissionTransition(computingRep, submissionFor("DRAFT"), "SUBMIT", numericNote),
    ).toEqual({ status: "ALLOW", nextStatus: "SUBMITTED", note: null });
    expect(() =>
      decideSubmissionTransition(computingApprover, submissionFor("SUBMITTED"), "RETURN", numericNote),
    ).not.toThrow();
    expect(
      decideSubmissionTransition(computingApprover, submissionFor("SUBMITTED"), "RETURN", numericNote),
    ).toEqual({ status: "NOTE_REQUIRED" });
  });

  it("RETURN: notes over 500 characters are NOTE_TOO_LONG and 500 characters are allowed", () => {
    const tooLongNote = "x".repeat(NOTE_MAX + 1);
    const maximumNote = "x".repeat(NOTE_MAX);
    expect(
      decideSubmissionTransition(
        computingApprover,
        submissionFor("SUBMITTED"),
        "RETURN",
        tooLongNote,
      ),
    ).toEqual({ status: "NOTE_TOO_LONG" });
    expect(
      decideSubmissionTransition(
        computingApprover,
        submissionFor("SUBMITTED"),
        "RETURN",
        maximumNote,
      ),
    ).toEqual({ status: "ALLOW", nextStatus: "RETURNED", note: maximumNote });
  });

  it("RETURN: DRAFT, RETURNED, and APPROVED are INVALID_STATE even with a valid note", () => {
    for (const state of ["DRAFT", "RETURNED", "APPROVED"] as const) {
      expect(
        decideSubmissionTransition(
          computingApprover,
          submissionFor(state),
          "RETURN",
          "valid note",
        ),
      ).toEqual({ status: "INVALID_STATE" });
    }
  });

  it("RETURN: maths approver and computing rep are FORBIDDEN before invalid notes are checked", () => {
    expect(
      decideSubmissionTransition(mathsApprover, submissionFor("SUBMITTED"), "RETURN", ""),
    ).toEqual({ status: "FORBIDDEN" });
    expect(
      decideSubmissionTransition(computingRep, submissionFor("SUBMITTED"), "RETURN", ""),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("SUBMIT: notes over 500 characters are NOTE_TOO_LONG and notes are trimmed", () => {
    expect(
      decideSubmissionTransition(
        computingRep,
        submissionFor("DRAFT"),
        "SUBMIT",
        "x".repeat(NOTE_MAX + 1),
      ),
    ).toEqual({ status: "NOTE_TOO_LONG" });
    expect(
      decideSubmissionTransition(
        computingRep,
        submissionFor("DRAFT"),
        "SUBMIT",
        "  please review  ",
      ),
    ).toEqual({ status: "ALLOW", nextStatus: "SUBMITTED", note: "please review" });
  });

  it("checks permission before state and note", () => {
    expect(
      decideSubmissionTransition(mathsRep, submissionFor("APPROVED"), "RETURN", ""),
    ).toEqual({ status: "FORBIDDEN" });
    expect(
      decideSubmissionTransition(computingApprover, submissionFor("DRAFT"), "RETURN", ""),
    ).toEqual({ status: "INVALID_STATE" });
  });

  it("unknown action is FORBIDDEN without throwing", () => {
    expect(() =>
      decideSubmissionTransition(
        computingRep,
        submissionFor("DRAFT"),
        "DELETE" as never,
      ),
    ).not.toThrow();
    expect(
      decideSubmissionTransition(
        computingRep,
        submissionFor("DRAFT"),
        "DELETE" as never,
      ),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("unknown role is FORBIDDEN without throwing", () => {
    const unknownRoleActor: Actor = {
      ...computingRep,
      role: "UNKNOWN" as UserRole,
    };
    expect(() =>
      decideSubmissionTransition(unknownRoleActor, submissionFor("DRAFT"), "SUBMIT"),
    ).not.toThrow();
    expect(
      decideSubmissionTransition(unknownRoleActor, submissionFor("DRAFT"), "SUBMIT"),
    ).toEqual({ status: "FORBIDDEN" });
  });
});

describe("availableSubmissionActions", () => {
  it("returns literal actions for computing rep, computing approver, officer, maths rep, and null actor", () => {
    expect(availableSubmissionActions(computingRep, submissionFor("DRAFT"))).toEqual(["SUBMIT"]);
    expect(availableSubmissionActions(computingRep, submissionFor("RETURNED"))).toEqual(["SUBMIT"]);
    expect(availableSubmissionActions(computingRep, submissionFor("SUBMITTED"))).toEqual([]);
    expect(availableSubmissionActions(computingRep, submissionFor("APPROVED"))).toEqual([]);

    expect(availableSubmissionActions(computingApprover, submissionFor("SUBMITTED"))).toEqual([
      "APPROVE",
      "RETURN",
    ]);
    expect(availableSubmissionActions(computingApprover, submissionFor("DRAFT"))).toEqual([]);
    expect(availableSubmissionActions(computingApprover, submissionFor("RETURNED"))).toEqual([]);
    expect(availableSubmissionActions(computingApprover, submissionFor("APPROVED"))).toEqual([]);

    for (const state of states) {
      expect(availableSubmissionActions(officer, submissionFor(state))).toEqual([]);
      expect(availableSubmissionActions(mathsRep, submissionFor(state))).toEqual([]);
      expect(availableSubmissionActions(null, submissionFor(state))).toEqual([]);
    }
  });
});

describe("submissionAuditReason", () => {
  it("returns literal base reasons for submit, approve, and return", () => {
    expect(submissionAuditReason("SUBMIT", "DRAFT", "SUBMITTED", null)).toBe(
      "submit: DRAFT -> SUBMITTED",
    );
    expect(submissionAuditReason("APPROVE", "SUBMITTED", "APPROVED", null)).toBe(
      "approve: SUBMITTED -> APPROVED",
    );
    expect(submissionAuditReason("RETURN", "SUBMITTED", "RETURNED", null)).toBe(
      "return: SUBMITTED -> RETURNED",
    );
  });

  it("appends a return note and truncates notes to 200 characters", () => {
    expect(
      submissionAuditReason(
        "RETURN",
        "SUBMITTED",
        "RETURNED",
        "Please add the missing lecturer",
      ),
    ).toBe("return: SUBMITTED -> RETURNED | note: Please add the missing lecturer");

    const note = "x".repeat(300);
    expect(submissionAuditReason("SUBMIT", "DRAFT", "SUBMITTED", note)).toBe(
      `submit: DRAFT -> SUBMITTED | note: ${"x".repeat(200)}`,
    );
  });
});

describe("submission transition walk-through", () => {
  it("submits, returns, resubmits, approves, then rejects every action on APPROVED", () => {
    let status: SubmissionStatus = "DRAFT";
    const submit = decideSubmissionTransition(computingRep, submissionFor(status), "SUBMIT");
    expect(submit).toEqual({ status: "ALLOW", nextStatus: "SUBMITTED", note: null });
    if (submit.status !== "ALLOW") throw new Error("Expected submission to be allowed");
    status = submit.nextStatus;

    const returned = decideSubmissionTransition(
      computingApprover,
      submissionFor(status),
      "RETURN",
      "Please add the missing lecturer",
    );
    expect(returned).toEqual({
      status: "ALLOW",
      nextStatus: "RETURNED",
      note: "Please add the missing lecturer",
    });
    if (returned.status !== "ALLOW") throw new Error("Expected return to be allowed");
    status = returned.nextStatus;

    const resubmitted = decideSubmissionTransition(
      computingRep,
      submissionFor(status),
      "SUBMIT",
    );
    expect(resubmitted).toEqual({ status: "ALLOW", nextStatus: "SUBMITTED", note: null });
    if (resubmitted.status !== "ALLOW") throw new Error("Expected resubmission to be allowed");
    status = resubmitted.nextStatus;

    const approved = decideSubmissionTransition(
      computingApprover,
      submissionFor(status),
      "APPROVE",
    );
    expect(approved).toEqual({ status: "ALLOW", nextStatus: "APPROVED", note: null });
    if (approved.status !== "ALLOW") throw new Error("Expected approval to be allowed");
    status = approved.nextStatus;

    const permittedActors: Record<SubmissionAction, Actor> = {
      SUBMIT: computingRep,
      APPROVE: computingApprover,
      RETURN: computingApprover,
    };
    for (const action of SUBMISSION_ACTIONS) {
      expect(
        decideSubmissionTransition(
          permittedActors[action],
          submissionFor(status),
          action,
          "valid note",
        ),
      ).toEqual({ status: "INVALID_STATE" });
    }
  });
});
