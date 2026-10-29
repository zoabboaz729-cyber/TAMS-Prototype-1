import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  SCOPES,
  type Action,
  type Scope,
  type Actor,
  allowedActions,
  canAct,
  permissionScope,
} from "../permissions";
import { type UserRole, USER_ROLES } from "../types";

const ROLES: UserRole[] = ["ADMIN", "OFFICER", "DEPT_REP", "APPROVER", "LECTURER", "STUDENT"];

/**
 * Expected scope for every role x every action (PROTOTYPE_SPEC §8).
 * Literal expected values — not computed from the implementation.
 */
const EXPECTED_SCOPE: Record<UserRole, Record<Action, Scope>> = {
  ADMIN: {
    MANAGE_USERS: "ALL",
    DECLARE_VENUE: "NONE",
    MANAGE_SHARED_VENUES: "NONE",
    EDIT_SUBMISSION: "NONE",
    REVIEW_SUBMISSION: "NONE",
    GENERATE_TIMETABLE: "NONE",
    EDIT_DRAFT: "NONE",
    PUBLISH_TIMETABLE: "NONE",
    REQUEST_RESCHEDULE: "NONE",
    DECIDE_RESCHEDULE: "NONE",
    REPORT_ISSUE: "NONE",
    SEE_ISSUES: "NONE",
    OPEN_ATTENDANCE: "NONE",
    SCAN_ATTENDANCE: "NONE",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "NONE",
  },
  OFFICER: {
    MANAGE_USERS: "NONE",
    DECLARE_VENUE: "ALL",
    MANAGE_SHARED_VENUES: "ALL",
    EDIT_SUBMISSION: "NONE",
    REVIEW_SUBMISSION: "NONE",
    GENERATE_TIMETABLE: "ALL",
    EDIT_DRAFT: "ALL",
    PUBLISH_TIMETABLE: "ALL",
    REQUEST_RESCHEDULE: "NONE",
    DECIDE_RESCHEDULE: "ALL",
    REPORT_ISSUE: "NONE",
    SEE_ISSUES: "ALL",
    OPEN_ATTENDANCE: "NONE",
    SCAN_ATTENDANCE: "NONE",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "ALL",
  },
  DEPT_REP: {
    MANAGE_USERS: "NONE",
    DECLARE_VENUE: "OWN_DEPARTMENT",
    MANAGE_SHARED_VENUES: "NONE",
    EDIT_SUBMISSION: "OWN_DEPARTMENT",
    REVIEW_SUBMISSION: "NONE",
    GENERATE_TIMETABLE: "NONE",
    EDIT_DRAFT: "NONE",
    PUBLISH_TIMETABLE: "NONE",
    REQUEST_RESCHEDULE: "NONE",
    DECIDE_RESCHEDULE: "NONE",
    REPORT_ISSUE: "OWN_DEPARTMENT",
    SEE_ISSUES: "OWN_DEPARTMENT",
    OPEN_ATTENDANCE: "NONE",
    SCAN_ATTENDANCE: "NONE",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "OWN_DEPARTMENT",
  },
  APPROVER: {
    MANAGE_USERS: "NONE",
    DECLARE_VENUE: "NONE",
    MANAGE_SHARED_VENUES: "NONE",
    EDIT_SUBMISSION: "NONE",
    REVIEW_SUBMISSION: "OWN_DEPARTMENT",
    GENERATE_TIMETABLE: "NONE",
    EDIT_DRAFT: "NONE",
    PUBLISH_TIMETABLE: "NONE",
    REQUEST_RESCHEDULE: "NONE",
    DECIDE_RESCHEDULE: "NONE",
    REPORT_ISSUE: "OWN_DEPARTMENT",
    SEE_ISSUES: "OWN_DEPARTMENT",
    OPEN_ATTENDANCE: "NONE",
    SCAN_ATTENDANCE: "NONE",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "OWN_DEPARTMENT",
  },
  LECTURER: {
    MANAGE_USERS: "NONE",
    DECLARE_VENUE: "NONE",
    MANAGE_SHARED_VENUES: "NONE",
    EDIT_SUBMISSION: "NONE",
    REVIEW_SUBMISSION: "NONE",
    GENERATE_TIMETABLE: "NONE",
    EDIT_DRAFT: "NONE",
    PUBLISH_TIMETABLE: "NONE",
    REQUEST_RESCHEDULE: "OWN_CLASSES",
    DECIDE_RESCHEDULE: "NONE",
    REPORT_ISSUE: "OWN_DEPARTMENT",
    SEE_ISSUES: "NONE",
    OPEN_ATTENDANCE: "OWN_CLASSES",
    SCAN_ATTENDANCE: "NONE",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "OWN_CLASSES",
  },
  STUDENT: {
    MANAGE_USERS: "NONE",
    DECLARE_VENUE: "NONE",
    MANAGE_SHARED_VENUES: "NONE",
    EDIT_SUBMISSION: "NONE",
    REVIEW_SUBMISSION: "NONE",
    GENERATE_TIMETABLE: "NONE",
    EDIT_DRAFT: "NONE",
    PUBLISH_TIMETABLE: "NONE",
    REQUEST_RESCHEDULE: "NONE",
    DECIDE_RESCHEDULE: "NONE",
    REPORT_ISSUE: "NONE",
    SEE_ISSUES: "NONE",
    OPEN_ATTENDANCE: "NONE",
    SCAN_ATTENDANCE: "OWN_GROUP",
    VIEW_TIMETABLE: "ALL",
    VIEW_VENUE_STATUS: "ALL",
    VIEW_ATTENDANCE_REPORT: "SELF",
  },
};

describe("permissionScope (spec §8 matrix)", () => {
  it("returns the expected scope for every role x every action (6 x 17 = 102 cells)", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(permissionScope(role, action)).toBe(EXPECTED_SCOPE[role][action]);
      }
    }
  });

  it("has an entry for every role and every action (no missing cells)", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(
          Object.prototype.hasOwnProperty.call(EXPECTED_SCOPE[role], action),
        ).toBe(true);
        expect(SCOPES.includes(permissionScope(role, action))).toBe(true);
      }
    }
  });
});

describe("canAct", () => {
  const deptRep: Actor = {
    id: "u-dept-rep-computing",
    role: "DEPT_REP",
    departmentId: "dept-computing",
    studentGroupId: null,
  };
  const lecturer: Actor = {
    id: "u-lecturer-1",
    role: "LECTURER",
    departmentId: "dept-computing",
    studentGroupId: null,
  };
  const lecturerNoDept: Actor = { ...lecturer, departmentId: null };
  const student: Actor = {
    id: "u-student-1",
    role: "STUDENT",
    departmentId: null,
    studentGroupId: "group-se-y4",
  };
  const officer: Actor = {
    id: "u-officer-1",
    role: "OFFICER",
    departmentId: null,
    studentGroupId: null,
  };

  it("allows a dept rep on their own department", () => {
    expect(canAct(deptRep, "EDIT_SUBMISSION", { departmentId: "dept-computing" })).toBe(true);
  });

  it("denies a dept rep on another department", () => {
    expect(canAct(deptRep, "EDIT_SUBMISSION", { departmentId: "dept-mathematics" })).toBe(false);
  });

  it("denies a dept rep when the resource is missing entirely", () => {
    expect(canAct(deptRep, "EDIT_SUBMISSION")).toBe(false);
  });

  it("denies an actor with null departmentId on OWN_DEPARTMENT scope", () => {
    expect(canAct(lecturerNoDept, "REPORT_ISSUE", { departmentId: "dept-computing" })).toBe(false);
  });

  it("denies OWN_DEPARTMENT when resource.departmentId is null", () => {
    expect(canAct(deptRep, "EDIT_SUBMISSION", { departmentId: null })).toBe(false);
  });

  it("allows a lecturer on their own class", () => {
    expect(canAct(lecturer, "REQUEST_RESCHEDULE", { ownerUserId: "u-lecturer-1" })).toBe(true);
  });

  it("denies a lecturer on another lecturer's class", () => {
    expect(canAct(lecturer, "REQUEST_RESCHEDULE", { ownerUserId: "u-lecturer-2" })).toBe(false);
  });

  it("denies a lecturer when ownerUserId is missing or null", () => {
    expect(canAct(lecturer, "REQUEST_RESCHEDULE", {})).toBe(false);
    expect(canAct(lecturer, "OPEN_ATTENDANCE", { ownerUserId: null })).toBe(false);
  });

  it("allows a student to scan their own group", () => {
    expect(canAct(student, "SCAN_ATTENDANCE", { groupId: "group-se-y4" })).toBe(true);
  });

  it("denies a student scanning another group", () => {
    expect(canAct(student, "SCAN_ATTENDANCE", { groupId: "group-cs-y2" })).toBe(false);
  });

  it("denies a student when groupId is missing or actor has no group", () => {
    expect(canAct(student, "SCAN_ATTENDANCE", {})).toBe(false);
    const studentNoGroup: Actor = { ...student, studentGroupId: null };
    expect(canAct(studentNoGroup, "SCAN_ATTENDANCE", { groupId: "group-se-y4" })).toBe(false);
  });

  it("allows a student SELF report for their own id", () => {
    expect(canAct(student, "VIEW_ATTENDANCE_REPORT", { subjectUserId: "u-student-1" })).toBe(true);
  });

  it("denies a student SELF report for another id", () => {
    expect(canAct(student, "VIEW_ATTENDANCE_REPORT", { subjectUserId: "u-student-2" })).toBe(false);
  });

  it("denies SELF when subjectUserId is missing", () => {
    expect(canAct(student, "VIEW_ATTENDANCE_REPORT", {})).toBe(false);
  });

  it("allows officer ALL with no resource", () => {
    expect(canAct(officer, "VIEW_TIMETABLE")).toBe(true);
    expect(canAct(officer, "GENERATE_TIMETABLE")).toBe(true);
    expect(canAct(officer, "DECLARE_VENUE", undefined)).toBe(true);
  });

  it("denies admin generating a timetable", () => {
    const admin: Actor = {
      id: "u-admin-1",
      role: "ADMIN",
      departmentId: null,
      studentGroupId: null,
    };
    expect(canAct(admin, "GENERATE_TIMETABLE")).toBe(false);
    expect(canAct(admin, "MANAGE_USERS", { departmentId: "dept-computing" })).toBe(true);
  });

  it("denies student MANAGE_USERS", () => {
    expect(canAct(student, "MANAGE_USERS")).toBe(false);
    expect(canAct(student, "MANAGE_USERS", { departmentId: "dept-computing" })).toBe(false);
  });

  it("denies a null actor for every action", () => {
    for (const action of ACTIONS) {
      expect(canAct(null, action)).toBe(false);
      expect(canAct(null, action, { departmentId: "dept-computing" })).toBe(false);
      expect(canAct(null, action, { ownerUserId: "u-lecturer-1" })).toBe(false);
    }
  });

  it("denies an unknown role cast in at runtime", () => {
    const unknownRoleActor: Actor = {
      id: "u-unknown",
      role: "NOT_A_ROLE" as UserRole,
      departmentId: null,
      studentGroupId: null,
    };
    expect(canAct(unknownRoleActor, "VIEW_TIMETABLE")).toBe(false);
    expect(canAct(unknownRoleActor, "VIEW_TIMETABLE", {})).toBe(false);
    expect(permissionScope("NOT_A_ROLE" as UserRole, "VIEW_TIMETABLE")).toBe("NONE");
  });

  it("denies an unknown action cast in at runtime", () => {
    expect(canAct(officer, "SUPER_ACTION" as Action)).toBe(false);
    expect(canAct(officer, "SUPER_ACTION" as Action, {})).toBe(false);
    expect(permissionScope("OFFICER", "SUPER_ACTION" as Action)).toBe("NONE");
  });

  it("treats NONE scope as denied even when a resource is given", () => {
    expect(canAct(student, "MANAGE_USERS", { departmentId: "dept-computing" })).toBe(false);
    expect(canAct(lecturer, "MANAGE_USERS", { ownerUserId: "u-lecturer-1" })).toBe(false);
  });
});

describe("allowedActions", () => {
  it("returns exactly the granted actions per role (in ACTIONS order)", () => {
    expect(allowedActions("ADMIN")).toEqual([
      "MANAGE_USERS",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
    ]);
    expect(allowedActions("OFFICER")).toEqual([
      "DECLARE_VENUE",
      "MANAGE_SHARED_VENUES",
      "GENERATE_TIMETABLE",
      "EDIT_DRAFT",
      "PUBLISH_TIMETABLE",
      "DECIDE_RESCHEDULE",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
      "VIEW_ATTENDANCE_REPORT",
      "SEE_ISSUES",
    ]);
    expect(allowedActions("DEPT_REP")).toEqual([
      "DECLARE_VENUE",
      "EDIT_SUBMISSION",
      "REPORT_ISSUE",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
      "VIEW_ATTENDANCE_REPORT",
      "SEE_ISSUES",
    ]);
    expect(allowedActions("APPROVER")).toEqual([
      "REVIEW_SUBMISSION",
      "REPORT_ISSUE",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
      "VIEW_ATTENDANCE_REPORT",
      "SEE_ISSUES",
    ]);
    expect(allowedActions("LECTURER")).toEqual([
      "REQUEST_RESCHEDULE",
      "REPORT_ISSUE",
      "OPEN_ATTENDANCE",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
      "VIEW_ATTENDANCE_REPORT",
    ]);
    expect(allowedActions("STUDENT")).toEqual([
      "SCAN_ATTENDANCE",
      "VIEW_TIMETABLE",
      "VIEW_VENUE_STATUS",
      "VIEW_ATTENDANCE_REPORT",
    ]);
  });

  it("never returns an action whose scope is NONE", () => {
    for (const role of ROLES) {
      for (const action of allowedActions(role)) {
        expect(permissionScope(role, action)).not.toBe("NONE");
      }
    }
  });
});