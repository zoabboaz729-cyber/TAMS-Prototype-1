import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import {
  buildVenueRows,
  summariseVenues,
  type VenueRecord,
} from "../venueRegister";
import { filterVenues } from "../venueRules";
import { seedDepartments, seedVenues } from "../seedData";

const officer: Actor = {
  id: "user-officer",
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};
const computingRep: Actor = {
  id: "user-deptrep-computing",
  role: "DEPT_REP",
  departmentId: "dept-computing",
  studentGroupId: null,
};
const mathematicsRep: Actor = {
  id: "user-deptrep-mathematics",
  role: "DEPT_REP",
  departmentId: "dept-mathematics",
  studentGroupId: null,
};
const lecturer: Actor = {
  id: "user-lecturer-1",
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
const deptRepNoDepartment: Actor = {
  id: "user-deptrep-none",
  role: "DEPT_REP",
  departmentId: null,
  studentGroupId: null,
};

const venues: VenueRecord[] = seedVenues.map((venue) => ({
  id: venue.id,
  code: venue.code,
  type: venue.type,
  capacity: venue.capacity,
  ownerDepartmentId: venue.ownerDepartmentId,
  facilities: JSON.stringify(venue.facilities),
  status: venue.status,
}));
const departments = seedDepartments.map((department) => ({
  id: department.id,
  name: department.name,
}));

const expectedOrder = [
  "CR1",
  "CR2",
  "CR3",
  "GR1",
  "GR2",
  "LAB1",
  "LAB2",
  "LH1",
  "LH2",
];

describe("buildVenueRows", () => {
  it("row order is CR1, CR2, CR3, GR1, GR2, LAB1, LAB2, LH1, LH2 for any actor", () => {
    for (const actor of [
      officer,
      computingRep,
      mathematicsRep,
      lecturer,
      student,
      deptRepNoDepartment,
      null,
    ]) {
      const rows = buildVenueRows(venues, departments, actor);
      expect(rows.map((row) => row.code)).toEqual(expectedOrder);
    }
  });

  it("officer: canEdit is true for all 9 rows", () => {
    const rows = buildVenueRows(venues, departments, officer);
    expect(rows).toHaveLength(9);
describe("summariseVenues", () => {
  it("seed rows with the three seed departments: 9 total, 2 shared, 7 owned, every department listed", () => {
    const rows = buildVenueRows(venues, departments, officer);
    const summary = summariseVenues(rows, departments);
    expect(summary.total).toBe(9);
    expect(summary.shared).toBe(2);
    expect(summary.owned).toBe(7);
    expect(summary.byOwner).toEqual([
      { departmentId: "dept-computing", name: "Computing", count: 5 },
      { departmentId: "dept-humanities", name: "Humanities", count: 0 },
      { departmentId: "dept-mathematics", name: "Mathematics", count: 2 },
    ]);
  });
});

describe("filterVenues on register rows", () => {
  it("ownership SHARED returns GR1 and GR2 with canEdit values intact", () => {
    const rows = buildVenueRows(venues, departments, computingRep);
    const shared = filterVenues(rows, { ownership: "SHARED" });
    expect(shared.map((row) => row.code)).toEqual(["GR1", "GR2"]);
    expect(shared.every((row) => row.canEdit === false)).toBe(true);
  });
});

    expect(rows.every((row) => row.canEdit)).toBe(true);
  });

  it("Computing rep: canEdit true exactly for CR1, CR2, LAB1, LAB2, LH1", () => {
    const rows = buildVenueRows(venues, departments, computingRep);
    expect(
      rows.filter((row) => row.canEdit).map((row) => row.code),
    ).toEqual(["CR1", "CR2", "LAB1", "LAB2", "LH1"]);
    expect(
      rows.filter((row) => !row.canEdit).map((row) => row.code),
    ).toEqual(["CR3", "GR1", "GR2", "LH2"]);
  });

  it("Mathematics rep: canEdit true exactly for CR3 and LH2", () => {
    const rows = buildVenueRows(venues, departments, mathematicsRep);
    expect(
      rows.filter((row) => row.canEdit).map((row) => row.code),
    ).toEqual(["CR3", "LH2"]);
    expect(
      rows.filter((row) => !row.canEdit).map((row) => row.code),
    ).toEqual(["CR1", "CR2", "GR1", "GR2", "LAB1", "LAB2", "LH1"]);
  });

  it("lecturer, student, department-less dept rep, and null actor: canEdit false for all 9", () => {
    for (const actor of [lecturer, student, deptRepNoDepartment, null]) {
      const rows = buildVenueRows(venues, departments, actor);
      expect(rows).toHaveLength(9);
      expect(rows.every((row) => !row.canEdit)).toBe(true);
    }
  });

  it("ownerName: shared venues are Shared (no owner), known departments by name", () => {
    const rows = buildVenueRows(venues, departments, officer);
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
    expect(byCode["GR1"].ownerName).toBe("Shared (no owner)");
    expect(byCode["GR2"].ownerName).toBe("Shared (no owner)");
    expect(byCode["CR1"].ownerName).toBe("Computing");
    expect(byCode["CR3"].ownerName).toBe("Mathematics");
  });

  it("a venue owned by a missing department is Unknown department and not editable by a Computing rep", () => {
    const unknown: VenueRecord = {
      id: "venue-unknown-1",
      code: "XX1",
      type: "ROOM",
      capacity: 30,
      ownerDepartmentId: "dept-does-not-exist",
      facilities: JSON.stringify(["projector"]),
      status: "ACTIVE",
    };
    const rows = buildVenueRows([unknown], departments, computingRep);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerName).toBe("Unknown department");
    expect(rows[0].canEdit).toBe(false);
    expect(rows[0].ownership).toBe("OWNED");
  });

  it("ownership: GR1 and GR2 are SHARED, the other seven are OWNED", () => {
    const rows = buildVenueRows(venues, departments, officer);
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
    expect(byCode["GR1"].ownership).toBe("SHARED");
    expect(byCode["GR2"].ownership).toBe("SHARED");
    for (const code of ["CR1", "CR2", "CR3", "LAB1", "LAB2", "LH1", "LH2"]) {
      expect(byCode[code].ownership).toBe("OWNED");
    }
  });

  it("facilities parses the stored JSON string; invalid JSON gives []", () => {
    const rows = buildVenueRows(venues, departments, officer);
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));
    expect(byCode["LAB1"].facilities).toEqual(["computers", "projector"]);
    expect(byCode["CR1"].facilities).toEqual([]);

    const broken: VenueRecord = {
      id: "venue-broken",
      code: "BK1",
      type: "ROOM",
      capacity: 10,
      ownerDepartmentId: null,
      facilities: "not json",
      status: "ACTIVE",
    };
    const brokenRows = buildVenueRows([broken], departments, officer);
    expect(brokenRows[0].facilities).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const before = [...venues];
    buildVenueRows(venues, departments, officer);
    buildVenueRows(venues, departments, computingRep);
    expect(venues).toEqual(before);
  });
});
