import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import { seedDepartments } from "../seedData";
import { ownerOptionsFor } from "../venueOwnerOptions";
import type { OwnerOption } from "../venueOwnerOptions";
import type { DepartmentRef } from "../venueRegister";

const departments: DepartmentRef[] = seedDepartments.map(({ id, name }) => ({
  id,
  name,
}));

function actor(
  id: string,
  role: Actor["role"],
  departmentId: string | null = null,
  studentGroupId: string | null = null,
): Actor {
  return { id, role, departmentId, studentGroupId };
}

const officer = actor("user-officer", "OFFICER");
const computingRep = actor("user-deptrep-computing", "DEPT_REP", "dept-computing");
const mathematicsRep = actor("user-deptrep-mathematics", "DEPT_REP", "dept-mathematics");

const allOwnerOptions: OwnerOption[] = [
  { value: "dept-computing", label: "Computing" },
  { value: "dept-humanities", label: "Humanities" },
  { value: "dept-mathematics", label: "Mathematics" },
  { value: "__SHARED__", label: "Shared (no owner)" },
];

describe("ownerOptionsFor", () => {
  it("officer CREATE offers every sorted department and shared", () => {
    expect(ownerOptionsFor(officer, departments, "CREATE", null)).toEqual(
      allOwnerOptions,
    );
  });

  it.each([
    ["Computing rep", computingRep, "dept-computing"],
    ["Mathematics rep", mathematicsRep, "dept-mathematics"],
  ] as const)("CREATE only offers the department allowed to %s", (_name, user, value) => {
    expect(ownerOptionsFor(user, departments, "CREATE", null)).toEqual(
      allOwnerOptions.filter((option) => option.value === value),
    );
  });

  it.each([
    ["department rep without a department", actor("user-nullrep", "DEPT_REP")],
    ["approver", actor("user-approver", "APPROVER", "dept-computing")],
    ["lecturer", actor("user-lecturer", "LECTURER", "dept-computing")],
    ["student", actor("user-student", "STUDENT", "dept-computing", "group-SE-Y4")],
    ["admin", actor("user-admin", "ADMIN")],
  ])("CREATE offers no owners to a %s", (_name, user) => {
    expect(ownerOptionsFor(user, departments, "CREATE", null)).toEqual([]);
  });

  it("CREATE offers no owners to a null actor", () => {
    expect(ownerOptionsFor(null, departments, "CREATE", null)).toEqual([]);
  });

  it("officer EDIT of a shared venue offers every sorted department and shared", () => {
    expect(
      ownerOptionsFor(officer, departments, "EDIT", { ownerDepartmentId: null }),
    ).toEqual(allOwnerOptions);
  });

  it("Computing rep EDIT of its department venue offers only its department", () => {
    expect(
      ownerOptionsFor(computingRep, departments, "EDIT", {
        ownerDepartmentId: "dept-computing",
      }),
    ).toEqual([allOwnerOptions[0]]);
  });

  it.each([
    ["another department's venue", "dept-mathematics"],
    ["a shared venue", null],
  ])("Computing rep EDIT of %s offers no owners", (_name, ownerDepartmentId) => {
    expect(
      ownerOptionsFor(computingRep, departments, "EDIT", { ownerDepartmentId }),
    ).toEqual([]);
  });

  it("a runtime-cast unknown role offers no owners", () => {
    const unknownActor = actor("user-unknown", "UNKNOWN" as Actor["role"]);
    expect(ownerOptionsFor(unknownActor, departments, "CREATE", null)).toEqual([]);
  });

  it("does not mutate the departments array", () => {
    const input = [...departments];
    const original = [...input];
    ownerOptionsFor(officer, input, "CREATE", null);
    expect(input).toEqual(original);
  });
});
