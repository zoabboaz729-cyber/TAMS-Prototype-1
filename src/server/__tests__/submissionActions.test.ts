import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeUser } from "@/server/auth";
import type {
  SubmissionAuditDraft,
  SubmissionStore,
  SubmissionUpdate,
  StoredSubmission,
} from "@/server/submissionWrite";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createPrismaSubmissionStore: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/submissionStorePrisma", () => ({
  createPrismaSubmissionStore: mocks.createPrismaSubmissionStore,
}));

import {
  approveDepartmentalSubmissionAction,
  returnDepartmentalSubmissionAction,
  submitDepartmentalSubmissionAction,
} from "@/app/submissions/actions";

const departmentRep: SafeUser = {
  id: "rep-computing",
  name: "Computing Representative",
  email: "rep-computing@demo.tams.test",
  role: "DEPT_REP",
  departmentId: "dept-computing",
  studentGroupId: null,
};

const departmentApprover: SafeUser = {
  id: "approver-computing",
  name: "Computing Approver",
  email: "approver-computing@demo.tams.test",
  role: "APPROVER",
  departmentId: "dept-computing",
  studentGroupId: null,
};

class FakeSubmissionStore implements SubmissionStore {
  readonly submissions = new Map<string, StoredSubmission>([
    [
      "draft-computing",
      {
        id: "draft-computing",
        departmentId: "dept-computing",
        semester: 1,
        status: "DRAFT",
        note: null,
        reviewerId: null,
      },
    ],
    [
      "submitted-computing",
      {
        id: "submitted-computing",
        departmentId: "dept-computing",
        semester: 1,
        status: "SUBMITTED",
        note: null,
        reviewerId: null,
      },
    ],
    [
      "draft-mathematics",
      {
        id: "draft-mathematics",
        departmentId: "dept-mathematics",
        semester: 1,
        status: "DRAFT",
        note: null,
        reviewerId: null,
      },
    ],
  ]);
  readonly audits: SubmissionAuditDraft[] = [];
  readonly transitionAttempts: string[] = [];

  async findSubmission(id: string): Promise<StoredSubmission | null> {
    const submission = this.submissions.get(id);
    return submission ? { ...submission } : null;
  }

  async applyTransition(
    id: string,
    expectedStatus: StoredSubmission["status"],
    update: SubmissionUpdate,
    audit: SubmissionAuditDraft,
  ) {
    this.transitionAttempts.push(id);
    const submission = this.submissions.get(id);
    if (submission === undefined) return { notFound: true } as const;
    if (submission.status !== expectedStatus) return { stale: true } as const;

    this.submissions.set(id, { ...submission, ...update });
    this.audits.push({ ...audit });
    return { ok: true } as const;
  }
}

let store: FakeSubmissionStore;

beforeEach(() => {
  vi.clearAllMocks();
  store = new FakeSubmissionStore();
  mocks.headers.mockResolvedValue(
    new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
  );
  mocks.getCurrentUser.mockResolvedValue(departmentRep);
  mocks.createPrismaSubmissionStore.mockReturnValue(store);
});

describe("submission server actions", () => {
  it("allows an authorized representative to submit an eligible record", async () => {
    const result = await submitDepartmentalSubmissionAction({
      submissionId: "draft-computing",
    });

    expect(result).toEqual({
      ok: true,
      submissionId: "draft-computing",
      status: "SUBMITTED",
    });
    expect(store.submissions.get("draft-computing")?.status).toBe("SUBMITTED");
    expect(store.audits).toEqual([
      {
        actorId: departmentRep.id,
        action: "SUBMISSION_SUBMIT",
        reason: "submit: DRAFT -> SUBMITTED",
      },
    ]);
  });

  it("does not allow a representative to submit another department's record", async () => {
    const before = structuredClone(Array.from(store.submissions.entries()));

    const result = await submitDepartmentalSubmissionAction({
      submissionId: "draft-mathematics",
    });

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    expect(Array.from(store.submissions.entries())).toEqual(before);
  });

  it("allows an authorized approver to approve an eligible record", async () => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const result = await approveDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
    });

    expect(result).toEqual({
      ok: true,
      submissionId: "submitted-computing",
      status: "APPROVED",
    });
    expect(store.submissions.get("submitted-computing")?.reviewerId).toBe(
      departmentApprover.id,
    );
    expect(store.audits[0]?.actorId).toBe(departmentApprover.id);
  });

  it("does not allow an approver to approve another department's record", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      ...departmentApprover,
      departmentId: "dept-mathematics",
    });
    const before = structuredClone(Array.from(store.submissions.entries()));

    const result = await approveDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
    });

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    expect(Array.from(store.submissions.entries())).toEqual(before);
  });

  it("allows an authorized approver to return a record with a trimmed reason", async () => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const result = await returnDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
      reason: "  Add missing lecturer  ",
    });

    expect(result).toEqual({
      ok: true,
      submissionId: "submitted-computing",
      status: "RETURNED",
    });
    expect(store.submissions.get("submitted-computing")?.note).toBe(
      "Add missing lecturer",
    );
    expect(store.submissions.get("submitted-computing")?.reviewerId).toBe(
      departmentApprover.id,
    );
    expect(store.audits[0]?.actorId).toBe(departmentApprover.id);
  });

  it.each([
    ["minimum length", "abc", 3],
    ["maximum length", "x".repeat(500), 500],
  ] as const)("accepts a return reason at the %s boundary", async (_case, reason, length) => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const result = await returnDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
      reason,
    });

    expect(result).toMatchObject({ ok: true, status: "RETURNED" });
    expect(store.submissions.get("submitted-computing")?.note).toHaveLength(length);
    expect(store.audits).toHaveLength(1);
  });

  it.each([
    ["shorter than 3 after trimming", "  x  ", "NOTE_REQUIRED"],
    ["longer than 500 after trimming", ` ${"x".repeat(501)} `, "NOTE_TOO_LONG"],
  ] as const)("rejects a return reason %s", async (_case, reason, expectedReason) => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const result = await returnDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
      reason,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "VALIDATION",
      reason: expectedReason,
    });
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    expect(store.submissions.get("submitted-computing")?.status).toBe("SUBMITTED");
  });

  it.each([
    [
      "submit",
      () => submitDepartmentalSubmissionAction({ submissionId: "draft-computing" }),
    ],
    [
      "approve",
      () =>
        approveDepartmentalSubmissionAction({
          submissionId: "submitted-computing",
        }),
    ],
    [
      "return",
      () =>
        returnDepartmentalSubmissionAction({
          submissionId: "submitted-computing",
          reason: "Valid reason",
        }),
    ],
  ])("rejects unauthenticated %s calls without performing a write", async (_action, invoke) => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const result = await invoke();

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(mocks.createPrismaSubmissionStore).not.toHaveBeenCalled();
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("returns a safe error when storage fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(store, "findSubmission").mockRejectedValue(
      new Error("database details must not reach the caller"),
    );

    const result = await submitDepartmentalSubmissionAction({
      submissionId: "draft-computing",
    });

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("database details");
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    errorLog.mockRestore();
  });

  it("does not let client-supplied identity or workflow fields override server data", async () => {
    const submitResult = await submitDepartmentalSubmissionAction({
      submissionId: "draft-computing",
      userId: "attacker",
      role: "APPROVER",
      departmentId: "dept-mathematics",
      reviewerId: "attacker",
      status: "APPROVED",
    });

    expect(submitResult).toMatchObject({ ok: true, status: "SUBMITTED" });
    expect(store.submissions.get("draft-computing")).toMatchObject({
      departmentId: "dept-computing",
      status: "SUBMITTED",
      reviewerId: null,
    });
    expect(store.audits[0]?.actorId).toBe(departmentRep.id);

    mocks.getCurrentUser.mockResolvedValue(departmentApprover);
    const approveResult = await approveDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
      role: "DEPT_REP",
      departmentId: "dept-mathematics",
      reviewerId: "attacker",
      status: "DRAFT",
    });

    expect(approveResult).toMatchObject({ ok: true, status: "APPROVED" });
    expect(store.submissions.get("submitted-computing")).toMatchObject({
      departmentId: "dept-computing",
      status: "APPROVED",
      reviewerId: departmentApprover.id,
    });
    expect(store.audits[1]?.actorId).toBe(departmentApprover.id);
  });

  it("rejects unknown ids and ineligible stored states without audit writes", async () => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const unknownResult = await approveDepartmentalSubmissionAction({
      submissionId: "unknown-submission",
    });
    const invalidStateResult = await approveDepartmentalSubmissionAction({
      submissionId: "draft-computing",
    });

    expect(unknownResult).toEqual({ ok: false, kind: "NOT_FOUND" });
    expect(invalidStateResult).toEqual({ ok: false, kind: "INVALID_STATE" });
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects cross-origin calls before authentication or writes", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: "http://attacker.example",
        host: "localhost:3000",
      }),
    );

    const result = await submitDepartmentalSubmissionAction({
      submissionId: "draft-computing",
    });

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects malformed identifiers and reasons before creating the store", async () => {
    mocks.getCurrentUser.mockResolvedValue(departmentApprover);

    const idResult = await submitDepartmentalSubmissionAction({
      submissionId: "  ",
    });
    const returnIdResult = await returnDepartmentalSubmissionAction({
      submissionId: "  ",
      reason: "valid reason",
    });
    const reasonResult = await returnDepartmentalSubmissionAction({
      submissionId: "submitted-computing",
      reason: 17,
    });

    expect(idResult).toMatchObject({
      ok: false,
      kind: "VALIDATION",
      reason: "INVALID_SUBMISSION_ID",
    });
    expect(returnIdResult).toMatchObject({
      ok: false,
      kind: "VALIDATION",
      reason: "INVALID_SUBMISSION_ID",
    });
    expect(reasonResult).toMatchObject({
      ok: false,
      kind: "VALIDATION",
      reason: "NOTE_REQUIRED",
    });
    expect(mocks.createPrismaSubmissionStore).not.toHaveBeenCalled();
    expect(store.transitionAttempts).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });
});
