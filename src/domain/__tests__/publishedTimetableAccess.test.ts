import { describe, expect, it } from "vitest";
import type { Actor } from "../permissions";
import { timetableAccess, canSelectTimetable, canReadTimetableEntry } from "../publishedTimetableAccess";
const groups = [{ id: "g1", departmentId: "d1" }, { id: "g2", departmentId: "d2" }, { id: "g3" }];
const lecturers = [{ id: "l1", userId: "u1" }, { id: "l2", userId: "u2" }];
const teachings = [{ groupId: "g1", lecturerId: "l1" }, { groupId: "g2", lecturerId: "l1" }, { groupId: "g2", lecturerId: "l2" }];
const actor = (role: Actor["role"], over: Partial<Actor> = {}): Actor => ({ id: "u1", role, departmentId: "d1", studentGroupId: "g1", ...over });
const scope = (a: Actor) => timetableAccess(a, groups, lecturers, teachings);
describe("published timetable least privilege", () => {
  it.each(["OFFICER", "ADMIN"] as const)("%s retains explicit scheduling oversight", role => {
    const a = scope(actor(role));
    expect(a.perspectives).toEqual(["group", "lecturer", "venue"]);
    expect(canSelectTimetable(a, "venue", "v1")).toBe(true);
    expect(canReadTimetableEntry(a, actor(role), teachings[2])).toBe(true);
  });
  it("student can select only the linked group and read its classes", () => {
    const a = actor("STUDENT"), s = scope(a);
    expect(s.groupIds).toEqual(["g1"]);
    expect(canSelectTimetable(s, "group", "g1")).toBe(true);
    expect(canSelectTimetable(s, "group", "g2")).toBe(false);
    expect(canSelectTimetable(s, "lecturer", "l1")).toBe(false);
    expect(canSelectTimetable(s, "venue", "v1")).toBe(false);
    expect(canReadTimetableEntry(s, a, teachings[0])).toBe(true);
    expect(canReadTimetableEntry(s, a, teachings[1])).toBe(false);
  });
  it("lecturer uses User identity, taught groups and only own sessions", () => {
    const a = actor("LECTURER"), s = scope(a);
    expect(s.groupIds).toEqual(["g1", "g2"]);
    expect(s.lecturerIds).toEqual(["l1"]);
    expect(canSelectTimetable(s, "lecturer", "l2")).toBe(false);
    expect(canSelectTimetable(s, "group", "g3")).toBe(false);
    expect(canReadTimetableEntry(s, a, teachings[1])).toBe(true);
    expect(canReadTimetableEntry(s, a, teachings[2])).toBe(false);
  });
  it.each(["DEPT_REP", "APPROVER"] as const)("%s sees own groups and relevant cross-department staff only", role => {
    const a = actor(role), s = scope(a);
    expect(s.groupIds).toEqual(["g1"]);
    expect(s.lecturerIds).toEqual(["l1"]);
    expect(canSelectTimetable(s, "lecturer", "l1")).toBe(true);
    expect(canSelectTimetable(s, "venue", "v1")).toBe(false);
    expect(canReadTimetableEntry(s, a, teachings[0])).toBe(true);
    expect(canReadTimetableEntry(s, a, teachings[1])).toBe(false);
  });
  it("missing ownership or relationships never broadens access", () => {
    expect(scope(actor("STUDENT", { studentGroupId: null })).groupIds).toEqual([]);
    expect(scope(actor("LECTURER", { id: "l1" })).lecturerIds).toEqual([]);
    expect(scope(actor("DEPT_REP", { departmentId: null })).perspectives).toEqual([]);
    expect(timetableAccess(actor("LECTURER"), groups, lecturers, []).groupIds).toEqual([]);
    expect(timetableAccess(actor("APPROVER"), [{ id: "g1" }], lecturers, teachings).groupIds).toEqual([]);
  });
  it("unknown role fails closed", () => {
    const s = scope(actor("UNKNOWN" as Actor["role"]));
    expect(s.perspectives).toEqual([]);
    expect(canSelectTimetable(s, "group", "g1")).toBe(false);
  });
});
