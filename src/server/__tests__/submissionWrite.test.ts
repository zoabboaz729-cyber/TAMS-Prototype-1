import { describe, expect, it } from "vitest";
import { seedSubmissions } from "../../domain/seedData";
import type { Actor } from "../../domain/permissions";
import type { SubmissionStatus } from "../../domain/types";
import { performSubmissionWrite, type SubmissionAuditDraft, type SubmissionStore, type SubmissionUpdate } from "../submissionWrite";

const computingRep: Actor = {
  id: "user-deptrep-computing",
  role: "DEPT_REP",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsRep: Actor = {
  id: "user-deptrep-maths",
  role: "DEPT_REP",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const computingApprover: Actor = {
  id: "user-approver-computing",
  role: "APPROVER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsApprover: Actor = {
  id: "user-approver-maths",
  role: "APPROVER",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const officer: Actor = {
  id: "user-officer",
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};
const admin: Actor = {
  id: "user-admin",
  role: "ADMIN",
  departmentId: null,
  studentGroupId: null,
};
const lecturer: Actor = {
  id: "user-lecturer-a",
  role: "LECTURER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const student: Actor = {
  id: "user-student-1",
  role: "STUDENT",
  departmentId: null,
  studentGroupId: "group-SE-Y4",
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

class FakeSubmissionStore implements SubmissionStore {
  submissions = new Map<string, { id: string; departmentId: string; semester: number; status: SubmissionStatus; note: string | null; reviewerId: string | null }>();
  applyCalls: Array<{ id: string; expectedStatus: SubmissionStatus; update: SubmissionUpdate; audit: SubmissionAuditDraft }> = [];
  beforeApply?: () => void;
  forceNotFound = false;

  constructor() {
    for (const row of seedSubmissions) {
      this.submissions.set(row.id, { ...row, status: row.status, note: row.note, reviewerId: row.reviewerId });
    }
  }

  async findSubmission(id: string) {
    const row = this.submissions.get(id);
    return row ? { ...row } : null;
  }

  async applyTransition(id: string, expectedStatus: SubmissionStatus, update: SubmissionUpdate, audit: SubmissionAuditDraft) {
    this.applyCalls.push({ id, expectedStatus, update: { ...update }, audit: { ...audit } });
    if (this.beforeApply) {
      this.beforeApply();
    }
    if (this.forceNotFound) {
      return { notFound: true } as const;
    }

    const current = this.submissions.get(id);
    if (!current) {
      return { notFound: true } as const;
    }
    if (current.status !== expectedStatus) {
      return { stale: true } as const;
    }

    this.submissions.set(id, { ...current, ...update });
    return { ok: true } as const;
  }
}

function copyOf(store: FakeSubmissionStore) {
  return structuredClone(Array.from(store.submissions.entries()));
}

function expectNoWrites(
  store: FakeSubmissionStore,
  before: ReturnType<typeof copyOf>,
) {
  expect(store.applyCalls).toHaveLength(0);
  expect(Array.from(store.submissions.entries())).toEqual(before);
}

describe("performSubmissionWrite", () => {
  it("S1: null actor -> UNAUTHENTICATED", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, null, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectNoWrites(store, before);
  });

  it("S2: student is FORBIDDEN on SUBMIT for a computing submission", async () => {
    const store = new FakeSubmissionStore();
    for (const action of ["SUBMIT", "APPROVE", "RETURN"] as const) {
      const before = copyOf(store);
      const result = await performSubmissionWrite(store, student, {
        submissionId: "sub-computing-s1",
        action,
        note: action === "RETURN" ? "valid note" : undefined,
      });
      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoWrites(store, before);
    }
  });

  it("S3: lecturer is FORBIDDEN on APPROVE and RETURN for a computing submission", async () => {
    const store = new FakeSubmissionStore();
    const beforeSubmit = copyOf(store);
    const submitResult = await performSubmissionWrite(store, lecturer, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
      note: "valid note",
    });
    expectNoWrites(store, beforeSubmit);
    const beforeApprove = copyOf(store);
    const approveResult = await performSubmissionWrite(store, lecturer, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
      note: "valid note",
    });
    expectNoWrites(store, beforeApprove);
    const beforeReturn = copyOf(store);
    const returnResult = await performSubmissionWrite(store, lecturer, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: "valid note",
    });
    expectNoWrites(store, beforeReturn);
    expect(submitResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(approveResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(returnResult).toEqual({ ok: false, kind: "FORBIDDEN" });
  });

  it("S4: admin is FORBIDDEN on SUBMIT, APPROVE and RETURN", async () => {
    const store = new FakeSubmissionStore();
    const actions: Array<"SUBMIT" | "APPROVE" | "RETURN"> = ["SUBMIT", "APPROVE", "RETURN"];
    for (const action of actions) {
      const before = copyOf(store);
      const result = await performSubmissionWrite(store, admin, {
        submissionId: "sub-computing-s1",
        action,
        note: "valid note",
      });
      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoWrites(store, before);
    }
  });

  it("S5: officer is FORBIDDEN on SUBMIT, APPROVE and RETURN", async () => {
    const store = new FakeSubmissionStore();
    for (const action of ["SUBMIT", "APPROVE", "RETURN"] as const) {
      const before = copyOf(store);
      const result = await performSubmissionWrite(store, officer, {
        submissionId: "sub-computing-s1",
        action,
        note: "valid note",
      });
      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoWrites(store, before);
    }
  });

  it("S6: forbidden roles on an UNKNOWN id return FORBIDDEN before lookup", async () => {
    const store = new FakeSubmissionStore();
    for (const actor of [student, lecturer, admin, officer]) {
      for (const action of ["SUBMIT", "APPROVE", "RETURN"] as const) {
        const before = copyOf(store);
        const result = await performSubmissionWrite(store, actor, {
          submissionId: "missing-submission",
          action,
          note: action === "RETURN" ? "valid note" : undefined,
        });
        expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
        expectNoWrites(store, before);
      }
    }
  });

  it("S7: computing rep can submit a DRAFT submission", async () => {
    const store = new FakeSubmissionStore();
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });

    expect(result).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });
    expect(store.submissions.get("sub-computing-s1")?.status).toBe("SUBMITTED");
    expect(store.submissions.get("sub-computing-s1")?.note).toBeNull();
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBeNull();
    expect(store.applyCalls).toHaveLength(1);
    expect(store.applyCalls[0].audit).toEqual({
      actorId: "user-deptrep-computing",
      action: "SUBMISSION_SUBMIT",
      reason: "submit: DRAFT -> SUBMITTED",
    });
  });

  it("S8: computing rep SUBMIT with a note trims the note and stores it", async () => {
    const store = new FakeSubmissionStore();
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
      note: "  first draft  ",
    });
    expect(result).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });
    expect(store.submissions.get("sub-computing-s1")?.note).toBe("first draft");
    expect(store.applyCalls[0].audit.reason).toContain("| note: first draft");
  });

  it("S9: disallowed rep/approver roles are FORBIDDEN on submission", async () => {
    const store = new FakeSubmissionStore();
    for (const actor of [mathsRep, repWithoutDepartment, computingApprover, mathsApprover]) {
      const before = copyOf(store);
      const result = await performSubmissionWrite(store, actor, {
        submissionId: "sub-computing-s1",
        action: "SUBMIT",
      });
      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoWrites(store, before);
    }
  });

  it("S10: computing rep SUBMIT on unknown id returns NOT_FOUND", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "missing-submission",
      action: "SUBMIT",
    });
    expect(result).toEqual({ ok: false, kind: "NOT_FOUND" });
    expectNoWrites(store, before);
  });

  it("S11: computing rep SUBMIT on another department is FORBIDDEN", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-maths-s1",
      action: "SUBMIT",
    });
    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, before);
  });

  it("S12: SUBMIT on a SUBMITTED or APPROVED submission is INVALID_STATE", async () => {
    const store = new FakeSubmissionStore();
    const submitted = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(submitted).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });

    store.submissions.set("sub-computing-s1", {
      ...store.submissions.get("sub-computing-s1")!,
      status: "SUBMITTED",
    });
    const invalidSubmitted = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(invalidSubmitted).toEqual({ ok: false, kind: "INVALID_STATE" });

    store.submissions.set("sub-computing-s1", {
      ...store.submissions.get("sub-computing-s1")!,
      status: "APPROVED",
    });
    const invalidApproved = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(invalidApproved).toEqual({ ok: false, kind: "INVALID_STATE" });
  });

  it("S13: maths approver may approve the maths submission", async () => {
    const store = new FakeSubmissionStore();
    const result = await performSubmissionWrite(store, mathsApprover, {
      submissionId: "sub-maths-s1",
      action: "APPROVE",
    });
    expect(result).toEqual({ ok: true, submissionId: "sub-maths-s1", status: "APPROVED" });
    expect(store.submissions.get("sub-maths-s1")?.status).toBe("APPROVED");
    expect(store.submissions.get("sub-maths-s1")?.reviewerId).toBe("user-approver-maths");
    expect(store.applyCalls[0].audit).toEqual({
      actorId: "user-approver-maths",
      action: "SUBMISSION_APPROVE",
      reason: "approve: SUBMITTED -> APPROVED",
    });
  });

  it("S14: forbidden roles cannot approve across departments or without a department", async () => {
    const store = new FakeSubmissionStore();
    const beforeComputing = copyOf(store);
    const computingResult = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-maths-s1",
      action: "APPROVE",
    });
    expect(computingResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, beforeComputing);

    const beforeMaths = copyOf(store);
    const mathsResult = await performSubmissionWrite(store, mathsApprover, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
    });
    expect(mathsResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, beforeMaths);

    const beforeNoDepartment = copyOf(store);
    const noDepartmentResult = await performSubmissionWrite(store, approverWithoutDepartment, {
      submissionId: "sub-maths-s1",
      action: "APPROVE",
    });
    expect(noDepartmentResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, beforeNoDepartment);
  });

  it("S15: approver on DRAFT submission is INVALID_STATE", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
      note: "valid note",
    });
    expect(result).toEqual({ ok: false, kind: "INVALID_STATE" });
    expectNoWrites(store, before);
  });

  it("S16: maths approver can return sub-maths-s1 with a note", async () => {
    const store = new FakeSubmissionStore();
    const result = await performSubmissionWrite(store, mathsApprover, {
      submissionId: "sub-maths-s1",
      action: "RETURN",
      note: "Add the missing lecturer",
    });
    expect(result).toEqual({ ok: true, submissionId: "sub-maths-s1", status: "RETURNED" });
    expect(store.submissions.get("sub-maths-s1")?.status).toBe("RETURNED");
    expect(store.submissions.get("sub-maths-s1")?.note).toBe("Add the missing lecturer");
    expect(store.submissions.get("sub-maths-s1")?.reviewerId).toBe("user-approver-maths");
    expect(store.applyCalls[0].audit).toEqual({
      actorId: "user-approver-maths",
      action: "SUBMISSION_RETURN",
      reason: "return: SUBMITTED -> RETURNED | note: Add the missing lecturer",
    });
  });

  it("S17: returning with no note or too-short or too-long notes validates correctly", async () => {
    const store = new FakeSubmissionStore();
    store.submissions.set("sub-computing-s1", {
      ...store.submissions.get("sub-computing-s1")!,
      status: "SUBMITTED",
      note: null,
      reviewerId: null,
    });
    for (const note of [undefined, null, "", "   ", "ab"] as const) {
      const before = copyOf(store);
      const result = await performSubmissionWrite(store, computingApprover, {
        submissionId: "sub-computing-s1",
        action: "RETURN",
        note,
      });
      expect(result).toEqual({
        ok: false,
        kind: "VALIDATION",
        reason: "NOTE_REQUIRED",
        message: "Please give a reason of at least 3 characters when returning a submission",
      });
      expectNoWrites(store, before);
      expect(store.submissions.get("sub-computing-s1")?.status).toBe("SUBMITTED");
    }

    const tooLong = "x".repeat(501);
    const beforeTooLong = copyOf(store);
    const longResult = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: tooLong,
    });
    expect(longResult).toEqual({
      ok: false,
      kind: "VALIDATION",
      reason: "NOTE_TOO_LONG",
      message: "The note is too long (500 characters at most)",
    });
    expectNoWrites(store, beforeTooLong);
    expect(store.submissions.get("sub-computing-s1")?.status).toBe("SUBMITTED");

    const maxNote = "x".repeat(500);
    const maxResult = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: maxNote,
    });
    expect(maxResult).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "RETURNED" });
  });

  it("S18: forbidden actor cannot return on another department submission with no note", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-maths-s1",
      action: "RETURN",
      note: "",
    });
    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, before);
  });

  it("S19: invalid note on allowed approver in DRAFT state is INVALID_STATE not VALIDATION", async () => {
    const store = new FakeSubmissionStore();
    const before = copyOf(store);
    const result = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: "",
    });
    expect(result).toEqual({ ok: false, kind: "INVALID_STATE" });
    expectNoWrites(store, before);
  });

  it("S20: stale status from beforeApply yields CONFLICT and one call", async () => {
    const store = new FakeSubmissionStore();
    store.submissions.set("sub-computing-s1", {
      ...store.submissions.get("sub-computing-s1")!,
      status: "SUBMITTED",
      note: null,
      reviewerId: null,
    });
    store.beforeApply = () => {
      store.submissions.set("sub-computing-s1", {
        ...store.submissions.get("sub-computing-s1")!,
        status: "APPROVED",
      });
    };

    const result = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
    });

    expect(result).toEqual({ ok: false, kind: "CONFLICT" });
    expect(store.applyCalls).toHaveLength(1);
    expect(store.submissions.get("sub-computing-s1")?.status).toBe("APPROVED");
  });

  it("S21: forceNotFound yields NOT_FOUND and one call", async () => {
    const store = new FakeSubmissionStore();
    store.forceNotFound = true;
    const beforeSubmission = structuredClone(store.submissions.get("sub-computing-s1"));
    const result = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(result).toEqual({ ok: false, kind: "NOT_FOUND" });
    expect(store.applyCalls).toHaveLength(1);
    expect(store.submissions.get("sub-computing-s1")).toEqual(beforeSubmission);
  });

  it("S22: full walkthrough produces the expected audit sequence", async () => {
    const store = new FakeSubmissionStore();
    const first = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(first).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });
    expect(store.submissions.get("sub-computing-s1")?.note).toBeNull();
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBeNull();

    const second = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: "Please add the missing lecturer",
    });
    expect(second).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "RETURNED" });
    expect(store.submissions.get("sub-computing-s1")?.note).toBe("Please add the missing lecturer");
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBe("user-approver-computing");

    const third = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(third).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });
    expect(store.submissions.get("sub-computing-s1")?.note).toBeNull();
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBeNull();

    const fourth = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
    });
    expect(fourth).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "APPROVED" });
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBe("user-approver-computing");
    expect(store.submissions.get("sub-computing-s1")?.note).toBeNull();

    const invalidSubmit = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    const invalidApprove = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "APPROVE",
    });
    const invalidReturn = await performSubmissionWrite(store, computingApprover, {
      submissionId: "sub-computing-s1",
      action: "RETURN",
      note: "reason",
    });

    expect(invalidSubmit).toEqual({ ok: false, kind: "INVALID_STATE" });
    expect(invalidApprove).toEqual({ ok: false, kind: "INVALID_STATE" });
    expect(invalidReturn).toEqual({ ok: false, kind: "INVALID_STATE" });
    expect(store.applyCalls.map((call) => call.audit.reason)).toEqual([
      "submit: DRAFT -> SUBMITTED",
      "return: SUBMITTED -> RETURNED | note: Please add the missing lecturer",
      "submit: RETURNED -> SUBMITTED",
      "approve: SUBMITTED -> APPROVED",
    ]);
    expect(store.applyCalls.map((call) => call.audit.action)).toEqual([
      "SUBMISSION_SUBMIT",
      "SUBMISSION_RETURN",
      "SUBMISSION_SUBMIT",
      "SUBMISSION_APPROVE",
    ]);
  });

  it("S23: extra fields on request are ignored and stored values still decide", async () => {
    const store = new FakeSubmissionStore();
    const forgedRequest = {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
      departmentId: "dept-mathematics",
      status: "APPROVED",
      reviewerId: "attacker",
      role: "ADMIN",
    } as never;
    const result = await performSubmissionWrite(store, computingRep, forgedRequest);
    expect(result).toEqual({ ok: true, submissionId: "sub-computing-s1", status: "SUBMITTED" });
    expect(store.submissions.get("sub-computing-s1")?.status).toBe("SUBMITTED");
    expect(store.submissions.get("sub-computing-s1")?.departmentId).toBe("dept-computing");
    expect(store.submissions.get("sub-computing-s1")?.reviewerId).toBeNull();

    const mathsStore = new FakeSubmissionStore();
    const before = copyOf(mathsStore);
    const forbiddenResult = await performSubmissionWrite(mathsStore, mathsRep, forgedRequest);
    expect(forbiddenResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(mathsStore, before);
  });

  it("S24: runtime-cast unknown values are rejected without throwing", async () => {
    const store = new FakeSubmissionStore();
    const beforeAction = copyOf(store);
    const actionResult = await performSubmissionWrite(store, computingRep, {
      submissionId: "sub-computing-s1",
      action: "DELETE" as never,
    });
    expect(actionResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, beforeAction);

    const beforeRole = copyOf(store);
    const unknownRoleResult = await performSubmissionWrite(store, {
      ...computingRep,
      role: "UNKNOWN" as never,
    }, {
      submissionId: "sub-computing-s1",
      action: "SUBMIT",
    });
    expect(unknownRoleResult).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoWrites(store, beforeRole);
  });
});
