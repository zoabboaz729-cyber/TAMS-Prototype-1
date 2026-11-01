import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import {
  decideVenueWrite,
  type VenueFilter,
  type VenueOperation,
  filterVenues,
} from "../venueRules";
import { seedVenues } from "../seedData";
import type { UserRole } from "../types";

function deptRep(departmentId: string | null): Actor {
  return {
    id: "user-deptrep-computing",
    role: "DEPT_REP",
    departmentId,
    studentGroupId: null,
  };
}

const officer: Actor = {
  id: "user-officer",
  role: "OFFICER",
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
  departmentId: "dept-computing",
  studentGroupId: "group-SE-Y4",
};
const approver: Actor = {
  id: "user-approver-computing",
  role: "APPROVER",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const admin: Actor = {
  id: "user-admin",
  role: "ADMIN",
  departmentId: null,
  studentGroupId: null,
};

const computingVenue: { ownerDepartmentId: string | null } = {
  ownerDepartmentId: "dept-computing",
};
const mathematicsVenue: { ownerDepartmentId: string | null } = {
  ownerDepartmentId: "dept-mathematics",
};
const sharedVenue: { ownerDepartmentId: string | null } = {
  ownerDepartmentId: null,
};

describe("decideVenueWrite", () => {
  it("null actor -> UNAUTHENTICATED", () => {
    expect(decideVenueWrite(null, "CREATE", null, null)).toEqual({
      status: "UNAUTHENTICATED",
    });
    expect(
      decideVenueWrite(null, "EDIT", computingVenue, "dept-computing"),
    ).toEqual({ status: "UNAUTHENTICATED" });
  });

  it("officer CREATE shared -> ALLOW", () => {
    expect(decideVenueWrite(officer, "CREATE", null, null)).toEqual({
      status: "ALLOW",
    });
  });

  it("officer CREATE owned by any department -> ALLOW", () => {
    expect(decideVenueWrite(officer, "CREATE", null, "dept-computing")).toEqual(
      { status: "ALLOW" },
    );
    expect(decideVenueWrite(officer, "CREATE", null, "dept-mathematics")).toEqual(
      { status: "ALLOW" },
    );
    expect(decideVenueWrite(officer, "CREATE", null, "dept-humanities")).toEqual(
      { status: "ALLOW" },
    );
  });

  it("officer EDIT anything -> ALLOW", () => {
    expect(
      decideVenueWrite(officer, "EDIT", sharedVenue, "dept-mathematics"),
    ).toEqual({ status: "ALLOW" });
    expect(
      decideVenueWrite(officer, "EDIT", computingVenue, "dept-computing"),
    ).toEqual({ status: "ALLOW" });
  });

  it("dept rep (Computing) CREATE owned by Computing -> ALLOW", () => {
    expect(
      decideVenueWrite(deptRep("dept-computing"), "CREATE", null, "dept-computing"),
    ).toEqual({ status: "ALLOW" });
  });

  it("dept rep CREATE owned by Mathematics -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(deptRep("dept-computing"), "CREATE", null, "dept-mathematics"),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep CREATE shared -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(deptRep("dept-computing"), "CREATE", null, null),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep EDIT own venue keeping owner -> ALLOW", () => {
    expect(
      decideVenueWrite(
        deptRep("dept-computing"),
        "EDIT",
        computingVenue,
        "dept-computing",
      ),
    ).toEqual({ status: "ALLOW" });
  });

  it("dept rep EDIT a Mathematics venue -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(
        deptRep("dept-computing"),
        "EDIT",
        mathematicsVenue,
        "dept-mathematics",
      ),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep EDIT a shared venue -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(deptRep("dept-computing"), "EDIT", sharedVenue, null),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep EDIT own venue proposing another department as owner -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(
        deptRep("dept-computing"),
        "EDIT",
        computingVenue,
        "dept-mathematics",
      ),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep EDIT own venue proposing null (shared) -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(deptRep("dept-computing"), "EDIT", computingVenue, null),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("dept rep with departmentId null -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(deptRep(null), "CREATE", null, "dept-computing"),
    ).toEqual({ status: "FORBIDDEN" });
    expect(
      decideVenueWrite(deptRep(null), "EDIT", computingVenue, "dept-computing"),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("lecturer, student, approver and admin -> FORBIDDEN in every case", () => {
    const cases: Array<[Actor, VenueOperation, { ownerDepartmentId: string | null } | null, string | null]> = [
      [lecturer, "CREATE", null, null],
      [lecturer, "CREATE", null, "dept-computing"],
      [lecturer, "EDIT", computingVenue, "dept-computing"],
      [student, "CREATE", null, null],
      [student, "CREATE", null, "dept-computing"],
      [student, "EDIT", computingVenue, "dept-computing"],
      [approver, "CREATE", null, null],
      [approver, "CREATE", null, "dept-computing"],
      [approver, "EDIT", computingVenue, "dept-computing"],
      [admin, "CREATE", null, null],
      [admin, "CREATE", null, "dept-computing"],
      [admin, "EDIT", sharedVenue, null],
    ];
    for (const [actor, op, current, proposed] of cases) {
      expect(decideVenueWrite(actor, op, current, proposed)).toEqual({
        status: "FORBIDDEN",
      });
    }
  });

  it("CREATE with a non-null current -> FORBIDDEN", () => {
    expect(
      decideVenueWrite(officer, "CREATE", computingVenue, null),
    ).toEqual({ status: "FORBIDDEN" });
  });

  it("EDIT with a null current -> FORBIDDEN", () => {
    expect(decideVenueWrite(officer, "EDIT", null, "dept-computing")).toEqual({
      status: "FORBIDDEN",
    });
  });

  it("a runtime-cast unknown role -> FORBIDDEN and does not throw", () => {
    const unknownActor = {
      id: "user-x",
      role: "UNKNOWN_ROLE" as unknown as UserRole,
      departmentId: "dept-computing",
      studentGroupId: null,
    } as unknown as Actor;

    expect(() => decideVenueWrite(unknownActor, "CREATE", null, null)).not.toThrow();
    expect(() => decideVenueWrite(unknownActor, "EDIT", computingVenue, null)).not.toThrow();
    expect(decideVenueWrite(unknownActor, "CREATE", null, null)).toEqual({
      status: "FORBIDDEN",
    });
    expect(decideVenueWrite(unknownActor, "EDIT", computingVenue, null)).toEqual({
      status: "FORBIDDEN",
    });
  });
});

describe("filterVenues", () => {
  it("type LAB gives LAB1 and LAB2", () => {
    expect(filterVenues(seedVenues, { type: "LAB" }).map((v) => v.code)).toEqual(
      ["LAB1", "LAB2"],
    );
  });

  it("type HALL gives LH1 and LH2", () => {
    expect(filterVenues(seedVenues, { type: "HALL" }).map((v) => v.code)).toEqual(
      ["LH1", "LH2"],
    );
  });

  it("type ROOM gives the five rooms in seed order", () => {
    expect(filterVenues(seedVenues, { type: "ROOM" }).map((v) => v.code)).toEqual(
      ["CR1", "CR2", "CR3", "GR1", "GR2"],
    );
  });

  it("ownership SHARED gives GR1 and GR2", () => {
    expect(
      filterVenues(seedVenues, { ownership: "SHARED" }).map((v) => v.code),
    ).toEqual(["GR1", "GR2"]);
  });

  it("ownership OWNED gives the seven owned venues", () => {
    expect(
      filterVenues(seedVenues, { ownership: "OWNED" }).map((v) => v.code),
    ).toEqual(["LH1", "LH2", "CR1", "CR2", "CR3", "LAB1", "LAB2"]);
  });

  it("ownership ALL means no ownership filter", () => {
    expect(filterVenues(seedVenues, { ownership: "ALL" })).toHaveLength(9);
  });

  it("ownerDepartmentId dept-computing gives its five venues", () => {
    expect(
      filterVenues(seedVenues, { ownerDepartmentId: "dept-computing" }).map(
        (v) => v.code,
      ),
    ).toEqual(["LH1", "CR1", "CR2", "LAB1", "LAB2"]);
  });

  it("ownerDepartmentId dept-mathematics gives LH2 and CR3", () => {
    expect(
      filterVenues(seedVenues, { ownerDepartmentId: "dept-mathematics" }).map(
        (v) => v.code,
      ),
    ).toEqual(["LH2", "CR3"]);
  });

  it("minCapacity 80 includes equal-capacity venues (GR1 at exactly 80)", () => {
    expect(filterVenues(seedVenues, { minCapacity: 80 }).map((v) => v.code)).toEqual(
      ["LH1", "LH2", "GR1"],
    );
  });

  it("minCapacity 1001 gives an empty result", () => {
    expect(filterVenues(seedVenues, { minCapacity: 1001 })).toEqual([]);
  });

  it("status INACTIVE gives an empty result; ACTIVE gives all nine", () => {
    expect(filterVenues(seedVenues, { status: "INACTIVE" })).toEqual([]);
    expect(filterVenues(seedVenues, { status: "ACTIVE" })).toHaveLength(9);
  });

  it("text matches the venue code case-insensitively (substring)", () => {
    expect(filterVenues(seedVenues, { text: "lh" }).map((v) => v.code)).toEqual(
      ["LH1", "LH2"],
    );
    expect(filterVenues(seedVenues, { text: "gr" }).map((v) => v.code)).toEqual(
      ["GR1", "GR2"],
    );
    expect(filterVenues(seedVenues, { text: "CR3" }).map((v) => v.code)).toEqual(
      ["CR3"],
    );
    expect(filterVenues(seedVenues, { text: "xx" })).toEqual([]);
  });

  it("combined filters combine with AND", () => {
    expect(
      filterVenues(seedVenues, { type: "ROOM", ownership: "OWNED" }).map(
        (v) => v.code,
      ),
    ).toEqual(["CR1", "CR2", "CR3"]);
    expect(
      filterVenues(seedVenues, {
        type: "LAB",
        ownership: "OWNED",
        minCapacity: 40,
      }).map((v) => v.code),
    ).toEqual(["LAB1"]);
    expect(
      filterVenues(seedVenues, {
        type: "LAB",
        ownership: "OWNED",
        minCapacity: 30,
      }).map((v) => v.code),
    ).toEqual(["LAB1", "LAB2"]);
    expect(filterVenues(seedVenues, { type: "HALL", ownership: "SHARED" })).toEqual(
      [],
    );
  });

  it("does not mutate the input array", () => {
    const before = [...seedVenues];
    filterVenues(seedVenues, { type: "LAB", minCapacity: 35 });
    expect(seedVenues).toEqual(before);
  });

  it("an empty filter returns all venues in input order", () => {
    expect(filterVenues(seedVenues, {}).map((v) => v.code)).toEqual([
      "LH1",
      "LH2",
      "CR1",
      "CR2",
      "CR3",
      "LAB1",
      "LAB2",
      "GR1",
      "GR2",
    ]);
  });
});
