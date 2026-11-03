import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import {
  buildSubmissionRows,
  submissionNoticeFor,
  summariseTeaching,
  type SubmissionRecord,
  type SubmissionView,
} from "../submissionView";
import type { DepartmentRef } from "../venueRegister";

const computingRep: Actor = {
  id: "rep-computing",
  role: "DEPT_REP",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsRep: Actor = {
  id: "rep-maths",
  role: "DEPT_REP",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const computingApprover: Actor = {
  id: "approver-computing",
  role: "APPROVER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathsApprover: Actor = {
  id: "approver-maths",
  role: "APPROVER",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const officer: Actor = {
  id: "officer",
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};
const admin: Actor = {
  id: "admin",
  role: "ADMIN",
  departmentId: null,
  studentGroupId: null,
};
const lecturer: Actor = {
  id: "lecturer",
  role: "LECTURER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const student: Actor = {
  id: "student",
  role: "STUDENT",
  departmentId: "dept-computing",
  studentGroupId: "group-se-y4",
};
const repWithoutDepartment: Actor = {
  id: "rep-no-department",
  role: "DEPT_REP",
  departmentId: null,
  studentGroupId: null,
};
const approverWithoutDepartment: Actor = {
  id: "approver-no-department",
  role: "APPROVER",
  departmentId: null,
  studentGroupId: null,
};
const unknownRoleActor: Actor = {
  id: "unknown-role",
  role: "UNKNOWN" as Actor["role"],
  departmentId: "dept-computing",
  studentGroupId: null,
};

const departments: DepartmentRef[] = [
  { id: "dept-computing", name: "Computing" },
  { id: "dept-mathematics", name: "Mathematics" },
];

const computingDraft: SubmissionRecord = {
  id: "submission-computing-s1",
  departmentId: "dept-computing",
  semester: 1,
  status: "DRAFT",
  note: null,
  reviewerName: null,
};
const mathematicsSubmitted: SubmissionRecord = {
  id: "submission-mathematics-s1",
  departmentId: "dept-mathematics",
  semester: 1,
  status: "SUBMITTED",
  note: null,
  reviewerName: null,
};
const records = [computingDraft, mathematicsSubmitted];
const views = ["EDIT", "REVIEW", "OVERVIEW"] as const;

describe("buildSubmissionRows", () => {
  it("shows a Computing draft to its rep with a submit action", () => {
    expect(buildSubmissionRows(records, departments, computingRep, "EDIT")).toEqual([
      {
        id: "submission-computing-s1",
        departmentId: "dept-computing",
        departmentName: "Computing",
        semester: 1,
        semesterLabel: "Semester 1",
        status: "DRAFT",
        statusLabel: "Draft",
        statusTone: "neutral",
        note: null,
        reviewerName: null,
        actions: ["SUBMIT"],
      },
    ]);
  });

  it("shows a Mathematics submission to its rep without actions", () => {
    expect(buildSubmissionRows(records, departments, mathsRep, "EDIT")).toEqual([
      {
        id: "submission-mathematics-s1",
        departmentId: "dept-mathematics",
        departmentName: "Mathematics",
        semester: 1,
        semesterLabel: "Semester 1",
        status: "SUBMITTED",
        statusLabel: "Awaiting approval",
        statusTone: "info",
        note: null,
        reviewerName: null,
        actions: [],
      },
    ]);
  });

  it("only exposes submit or resubmit actions in the representative edit view", () => {
    const statuses: SubmissionRecord[] = [
      { ...computingDraft, status: "DRAFT" },
      { ...computingDraft, id: "returned", status: "RETURNED" },
      { ...computingDraft, id: "submitted", status: "SUBMITTED" },
      { ...computingDraft, id: "approved", status: "APPROVED" },
    ];

    expect(
      buildSubmissionRows(statuses, departments, computingRep, "EDIT").map(
        ({ status, actions }) => ({ status, actions }),
      ),
    ).toEqual([
      { status: "DRAFT", actions: ["SUBMIT"] },
      { status: "RETURNED", actions: ["SUBMIT"] },
      { status: "SUBMITTED", actions: [] },
      { status: "APPROVED", actions: [] },
    ]);
  });

  it("allows the Mathematics approver to review its submission", () => {
    expect(
      buildSubmissionRows(records, departments, mathsApprover, "REVIEW"),
    ).toMatchObject([
      {
        departmentName: "Mathematics",
        actions: ["APPROVE", "RETURN"],
      },
    ]);
  });

  it("limits review rows and actions to submitted records in the approver's department", () => {
    const reviewRecords: SubmissionRecord[] = [
      { ...computingDraft, id: "computing-submitted", status: "SUBMITTED" },
      { ...computingDraft, id: "computing-returned", status: "RETURNED" },
      { ...computingDraft, id: "computing-approved", status: "APPROVED" },
      mathematicsSubmitted,
    ];

    expect(
      buildSubmissionRows(
        reviewRecords,
        departments,
        computingApprover,
        "REVIEW",
      ).map(({ id, status, actions }) => ({ id, status, actions })),
    ).toEqual([
      {
        id: "computing-submitted",
        status: "SUBMITTED",
        actions: ["APPROVE", "RETURN"],
      },
      {
        id: "computing-returned",
        status: "RETURNED",
        actions: [],
      },
      {
        id: "computing-approved",
        status: "APPROVED",
        actions: [],
      },
    ]);
  });

  it("shows a Computing draft to its approver without actions", () => {
    expect(
      buildSubmissionRows(records, departments, computingApprover, "REVIEW"),
    ).toMatchObject([
      {
        departmentName: "Computing",
        status: "DRAFT",
        actions: [],
      },
    ]);
  });

  it("gives the officer a department-sorted overview without actions", () => {
    expect(
      buildSubmissionRows(records, departments, officer, "OVERVIEW"),
    ).toMatchObject([
      { departmentName: "Computing", actions: [] },
      { departmentName: "Mathematics", actions: [] },
    ]);
  });

  it("denies officer edit and review views", () => {
    expect(buildSubmissionRows(records, departments, officer, "EDIT")).toEqual([]);
    expect(buildSubmissionRows(records, departments, officer, "REVIEW")).toEqual([]);
  });

  it("denies Computing rep review and overview views", () => {
    expect(
      buildSubmissionRows(records, departments, computingRep, "REVIEW"),
    ).toEqual([]);
    expect(
      buildSubmissionRows(records, departments, computingRep, "OVERVIEW"),
    ).toEqual([]);
  });

  it("denies Computing approver edit and overview views", () => {
    expect(
      buildSubmissionRows(records, departments, computingApprover, "EDIT"),
    ).toEqual([]);
    expect(
      buildSubmissionRows(records, departments, computingApprover, "OVERVIEW"),
    ).toEqual([]);
  });

  it("denies admin, lecturer, student, and department-less actors in every view", () => {
    const deniedActors = [
      admin,
      lecturer,
      student,
      repWithoutDepartment,
      approverWithoutDepartment,
    ];
    for (const actor of deniedActors) {
      for (const view of views) {
        expect(buildSubmissionRows(records, departments, actor, view)).toEqual([]);
      }
    }
  });

  it("denies a null actor in every view", () => {
    for (const view of views) {
      expect(buildSubmissionRows(records, departments, null, view)).toEqual([]);
    }
  });

  it("denies an unknown-role actor in every view", () => {
    for (const view of views) {
      expect(
        buildSubmissionRows(records, departments, unknownRoleActor, view),
      ).toEqual([]);
    }
  });

  it("denies an unknown view", () => {
    expect(
      buildSubmissionRows(
        records,
        departments,
        officer,
        "BOGUS" as SubmissionView,
      ),
    ).toEqual([]);
  });

  it("preserves return note and reviewer and lets the owning rep resubmit", () => {
    const returned: SubmissionRecord = {
      ...computingDraft,
      status: "RETURNED",
      note: "Add the missing lecturer",
      reviewerName: "Mathematics Approver (sample)",
    };
    expect(
      buildSubmissionRows([returned], departments, computingRep, "EDIT"),
    ).toEqual([
      {
        id: "submission-computing-s1",
        departmentId: "dept-computing",
        departmentName: "Computing",
        semester: 1,
        semesterLabel: "Semester 1",
        status: "RETURNED",
        statusLabel: "Returned for changes",
        statusTone: "warning",
        note: "Add the missing lecturer",
        reviewerName: "Mathematics Approver (sample)",
        actions: ["SUBMIT"],
      },
    ]);
  });

  it("shows an approved submission without actions to its rep and approver", () => {
    const approved: SubmissionRecord = {
      ...computingDraft,
      status: "APPROVED",
    };
    expect(
      buildSubmissionRows([approved], departments, computingRep, "EDIT"),
    ).toMatchObject([
      {
        statusLabel: "Approved",
        statusTone: "success",
        actions: [],
      },
    ]);
    expect(
      buildSubmissionRows([approved], departments, computingApprover, "REVIEW"),
    ).toMatchObject([
      {
        statusLabel: "Approved",
        statusTone: "success",
        actions: [],
      },
    ]);
  });

  it("drops records with invalid submission statuses", () => {
    expect(
      buildSubmissionRows(
        [{ ...computingDraft, status: "BOGUS" }],
        departments,
        officer,
        "OVERVIEW",
      ),
    ).toEqual([]);
  });

  it("shows an unknown department only in the officer overview", () => {
    const unknownDepartment = {
      ...computingDraft,
      departmentId: "dept-unknown",
    };
    expect(
      buildSubmissionRows(
        [unknownDepartment],
        departments,
        officer,
        "OVERVIEW",
      ),
    ).toMatchObject([{ departmentName: "Unknown department" }]);
    expect(
      buildSubmissionRows(
        [unknownDepartment],
        departments,
        computingRep,
        "EDIT",
      ),
    ).toEqual([]);
    expect(
      buildSubmissionRows(
        [unknownDepartment],
        departments,
        computingApprover,
        "REVIEW",
      ),
    ).toEqual([]);
  });

  it("sorts rows by department name and then semester", () => {
    const unsorted: SubmissionRecord[] = [
      { ...mathematicsSubmitted, id: "math-s2", semester: 2 },
      { ...computingDraft, id: "computing-s2", semester: 2 },
      { ...mathematicsSubmitted, id: "math-s1", semester: 1 },
      { ...computingDraft, id: "computing-s1", semester: 1 },
    ];
    expect(
      buildSubmissionRows(unsorted, departments, officer, "OVERVIEW").map(
        (row) => row.id,
      ),
    ).toEqual(["computing-s1", "computing-s2", "math-s1", "math-s2"]);
  });

  it("does not mutate record or department input arrays", () => {
    const inputRecords = [mathematicsSubmitted, computingDraft];
    const inputDepartments = [...departments].reverse();
    const originalRecords = [...inputRecords];
    const originalDepartments = [...inputDepartments];

    buildSubmissionRows(inputRecords, inputDepartments, officer, "OVERVIEW");

    expect(inputRecords).toEqual(originalRecords);
    expect(inputDepartments).toEqual(originalDepartments);
  });
});

describe("submissionNoticeFor", () => {
  it("maps each notice key to its exact type and message", () => {
    expect(submissionNoticeFor("submitted")).toEqual({
      type: "success",
      message: "Submission sent for review.",
    });
    expect(submissionNoticeFor("approved")).toEqual({
      type: "success",
      message: "Submission approved.",
    });
    expect(submissionNoticeFor("returned")).toEqual({
      type: "info",
      message: "Submission returned to the department.",
    });
    expect(submissionNoticeFor("conflict")).toEqual({
      type: "warning",
      message:
        "Someone else changed this submission first. Please check it and try again.",
    });
    expect(submissionNoticeFor("invalid_state")).toEqual({
      type: "warning",
      message:
        "That action is not available for the submission's current status.",
    });
    expect(submissionNoticeFor("not_found")).toEqual({
      type: "warning",
      message: "That submission could not be found.",
    });
  });

  it("returns null for arrays, missing values, inherited keys, wrong casing, and trailing spaces", () => {
    expect(submissionNoticeFor([])).toBeNull();
    expect(submissionNoticeFor(undefined)).toBeNull();
    expect(submissionNoticeFor("toString")).toBeNull();
    expect(submissionNoticeFor("__proto__")).toBeNull();
    expect(submissionNoticeFor("Submitted")).toBeNull();
    expect(submissionNoticeFor("submitted ")).toBeNull();
  });
});

describe("summariseTeaching", () => {
  it("totals teaching records as hours per week", () => {
    expect(
      summariseTeaching([
        { sessionsPerWeek: 3, sessionLength: 1 },
        { sessionsPerWeek: 2, sessionLength: 2 },
        { sessionsPerWeek: 1, sessionLength: 1 },
      ]),
    ).toEqual({ count: 3, hoursPerWeek: 8 });
  });

  it("returns zero counts and hours for no teaching records", () => {
    expect(summariseTeaching([])).toEqual({ count: 0, hoursPerWeek: 0 });
  });
});
