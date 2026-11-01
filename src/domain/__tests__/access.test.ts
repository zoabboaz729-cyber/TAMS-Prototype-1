import { describe, it, expect } from "vitest";
import { decideAccess, decideAnyAccess } from "../access";
import type { AccessDecision } from "../access";
import type { Action, Actor, Resource } from "../permissions";
import { ACTIONS } from "../permissions";
import { type UserRole, USER_ROLES } from "../types";

const ROLES: UserRole[] = [
  "ADMIN",
  "OFFICER",
  "DEPT_REP",
  "APPROVER",
  "LECTURER",
  "STUDENT",
];

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

describe("decideAccess", () => {
  it("returns UNAUTHENTICATED for a null actor for every action", () => {
    for (const action of ACTIONS) {
      expect(decideAccess(null, action)).toEqual({
        status: "UNAUTHENTICATED",
      });
      expect(decideAccess(null, action, { departmentId: "dept-computing" })).toEqual({
        status: "UNAUTHENTICATED",
      });
      expect(decideAccess(null, action, { ownerUserId: "u-lecturer-1" })).toEqual({
        status: "UNAUTHENTICATED",
      });
    }
  });

  it("allows an officer to generate a timetable (ALL scope, no resource needed)", () => {
    expect(decideAccess(officer, "GENERATE_TIMETABLE")).toEqual({
      status: "ALLOW",
    });
    expect(decideAccess(officer, "GENERATE_TIMETABLE", undefined)).toEqual({
      status: "ALLOW",
    });
  });

  it("denies a student GENERATE_TIMETABLE and MANAGE_USERS", () => {
    expect(decideAccess(student, "GENERATE_TIMETABLE")).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideAccess(student, "GENERATE_TIMETABLE", {})).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideAccess(student, "MANAGE_USERS")).toEqual({
      status: "FORBIDDEN",
    });
    expect(
      decideAccess(student, "MANAGE_USERS", { departmentId: "dept-computing" }),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("allows a dept rep DECLARE_VENUE on their own department", () => {
    expect(
      decideAccess(deptRep, "DECLARE_VENUE", { departmentId: "dept-computing" }),
    ).toEqual({ status: "ALLOW" });
  });

  it("denies a dept rep DECLARE_VENUE on another department", () => {
    expect(
      decideAccess(deptRep, "DECLARE_VENUE", { departmentId: "dept-mathematics" }),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("denies a dept rep DECLARE_VENUE with no resource", () => {
    expect(decideAccess(deptRep, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
  });

  it("allows a lecturer OPEN_ATTENDANCE on their own class", () => {
    expect(
      decideAccess(lecturer, "OPEN_ATTENDANCE", { ownerUserId: "u-lecturer-1" }),
    ).toEqual({ status: "ALLOW" });
  });

  it("denies a lecturer OPEN_ATTENDANCE on another lecturer's class", () => {
    expect(
      decideAccess(lecturer, "OPEN_ATTENDANCE", { ownerUserId: "u-lecturer-2" }),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("denies a lecturer OPEN_ATTENDANCE when ownerUserId is missing or null", () => {
    expect(decideAccess(lecturer, "OPEN_ATTENDANCE", {})).toEqual({
      status: "FORBIDDEN",
    });
    expect(
      decideAccess(lecturer, "OPEN_ATTENDANCE", { ownerUserId: null }),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("denies a runtime-cast unknown role without throwing", () => {
    const unknownRoleActor: Actor = {
      id: "u-unknown",
      role: "NOT_A_ROLE" as UserRole,
      departmentId: null,
      studentGroupId: null,
    };
    expect(() => decideAccess(unknownRoleActor, "VIEW_TIMETABLE")).not.toThrow();
    expect(decideAccess(unknownRoleActor, "VIEW_TIMETABLE")).toEqual({
      status: "FORBIDDEN",
    });
    expect(() => decideAccess(unknownRoleActor, "MANAGE_USERS", {})).not.toThrow();
    expect(decideAccess(unknownRoleActor, "MANAGE_USERS", {})).toEqual({
      status: "FORBIDDEN",
    });
  });

  it("never returns a decision shape outside ALLOW / UNAUTHENTICATED / FORBIDDEN", () => {
    const sample: Actor = { ...officer };
    for (const role of ROLES) {
      const actor: Actor = { ...sample, role };
      for (const action of ACTIONS) {
        const decision: AccessDecision = decideAccess(actor, action);
        expect(
          decision.status === "ALLOW" ||
            decision.status === "UNAUTHENTICATED" ||
            decision.status === "FORBIDDEN",
        ).toBe(true);
      }
    }
  });
});

describe("decideAnyAccess", () => {
  const admin: Actor = {
    id: "u-admin-1",
    role: "ADMIN",
    departmentId: null,
    studentGroupId: null,
  };

  const approver: Actor = {
    id: "u-approver-1",
    role: "APPROVER",
    departmentId: "dept-computing",
    studentGroupId: null,
  };

  const deptRepNoDepartment: Actor = {
    ...deptRep,
    departmentId: null,
  };

  it("returns UNAUTHENTICATED for a null actor", () => {
    expect(decideAnyAccess(null, "DECLARE_VENUE")).toEqual({
      status: "UNAUTHENTICATED",
    });
    expect(decideAnyAccess(null, "MANAGE_USERS")).toEqual({
      status: "UNAUTHENTICATED",
    });
  });

  it("allows an officer DECLARE_VENUE at page level (scope ALL)", () => {
    expect(decideAnyAccess(officer, "DECLARE_VENUE")).toEqual({
      status: "ALLOW",
    });
  });

  it("allows a dept rep DECLARE_VENUE at page level (scope OWN_DEPARTMENT)", () => {
    expect(decideAnyAccess(deptRep, "DECLARE_VENUE")).toEqual({
      status: "ALLOW",
    });
  });

  it("allows a dept rep with departmentId null DECLARE_VENUE at page level", () => {
    expect(decideAnyAccess(deptRepNoDepartment, "DECLARE_VENUE")).toEqual({
      status: "ALLOW",
    });
  });

  it("forbids approver, lecturer, student and admin DECLARE_VENUE", () => {
    expect(decideAnyAccess(approver, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideAnyAccess(lecturer, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideAnyAccess(student, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideAnyAccess(admin, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
  });

  it("forbids a student MANAGE_USERS", () => {
    expect(decideAnyAccess(student, "MANAGE_USERS")).toEqual({
      status: "FORBIDDEN",
    });
  });

  it("allows an admin MANAGE_USERS", () => {
    expect(decideAnyAccess(admin, "MANAGE_USERS")).toEqual({
      status: "ALLOW",
    });
  });

  it("denies a runtime-cast unknown role without throwing", () => {
    const unknownRoleActor: Actor = {
      id: "u-unknown",
      role: "NOT_A_ROLE" as UserRole,
      departmentId: null,
      studentGroupId: null,
    };
    expect(() => decideAnyAccess(unknownRoleActor, "DECLARE_VENUE")).not.toThrow();
    expect(decideAnyAccess(unknownRoleActor, "DECLARE_VENUE")).toEqual({
      status: "FORBIDDEN",
    });
  });
});
