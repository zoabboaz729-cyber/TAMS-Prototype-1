import { describe, expect, it } from "vitest";
import { ROLE_LABEL, roleLabel } from "../roles";

describe("ROLE_LABEL / roleLabel", () => {
  it("returns the literal label for all six roles", () => {
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("OFFICER")).toBe("Timetabling Officer");
    expect(roleLabel("DEPT_REP")).toBe("Department Rep");
    expect(roleLabel("APPROVER")).toBe("Head of Department");
    expect(roleLabel("LECTURER")).toBe("Lecturer");
    expect(roleLabel("STUDENT")).toBe("Student");
  });

  it("matches ROLE_LABEL for every key in the record", () => {
    for (const role of Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]) {
      expect(roleLabel(role)).toBe(ROLE_LABEL[role]);
    }
  });

  it("returns an unknown string unchanged", () => {
    expect(roleLabel("")).toBe("");
    expect(roleLabel("TEACHER")).toBe("TEACHER");
    expect(roleLabel("admin")).toBe("admin");
  });

  it("returns '__proto__' unchanged (no prototype pollution)", () => {
    expect(roleLabel("__proto__")).toBe("__proto__");
  });

  it("returns 'toString' unchanged", () => {
    expect(roleLabel("toString")).toBe("toString");
  });
});