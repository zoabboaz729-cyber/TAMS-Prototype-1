import { describe, it, expect } from "vitest";
import {
  seedDepartments,
  seedVenues,
  seedVenueUnavailabilities,
  seedStudentGroups,
  seedUsers,
  seedLecturers,
  seedLecturerAvailabilities,
  seedUnits,
  seedTeachings,
  seedSubmissions,
  seedIssues,
  seedTimetableVersions,
  seedTimetableEntries,
} from "../seedData";

describe("Seed Integrity Check (seedData.ts pure assertions)", () => {
  it("satisfies required entity counts", () => {
    // 9 venues, 3 departments, 6 lecturers, 3 groups
    expect(seedVenues).toHaveLength(9);
    expect(seedDepartments).toHaveLength(3);
    expect(seedLecturers).toHaveLength(6);
    expect(seedStudentGroups).toHaveLength(3);

    // 13 real SOEN units of which exactly 1 has scheduled=false (SOEN 321) and 12 are scheduled
    const soenUnits = seedUnits.filter((u) => u.code.startsWith("SOEN"));
    expect(soenUnits).toHaveLength(13);

    const unscheduledSoen = soenUnits.filter((u) => !u.scheduled);
    expect(unscheduledSoen).toHaveLength(1);
    expect(unscheduledSoen[0].code).toBe("SOEN 321");

    const scheduledSoen = soenUnits.filter((u) => u.scheduled);
    expect(scheduledSoen).toHaveLength(12);
  });

  it("ensures all IDs are globally unique across all seed records", () => {
    const allIds = [
      ...seedDepartments.map((d) => d.id),
      ...seedVenues.map((v) => v.id),
      ...seedVenueUnavailabilities.map((vu) => vu.id),
      ...seedStudentGroups.map((g) => g.id),
      ...seedUsers.map((u) => u.id),
      ...seedLecturers.map((l) => l.id),
      ...seedLecturerAvailabilities.map((la) => la.id),
      ...seedUnits.map((u) => u.id),
      ...seedTeachings.map((t) => t.id),
      ...seedSubmissions.map((s) => s.id),
      ...seedIssues.map((i) => i.id),
      ...seedTimetableVersions.map((tv) => tv.id),
      ...seedTimetableEntries.map((te) => te.id),
    ];

    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("validates referential integrity for all foreign keys", () => {
    const deptIds = new Set(seedDepartments.map((d) => d.id));
    const venueIds = new Set(seedVenues.map((v) => v.id));
    const groupIds = new Set(seedStudentGroups.map((g) => g.id));
    const userIds = new Set(seedUsers.map((u) => u.id));
    const lecturerIds = new Set(seedLecturers.map((l) => l.id));
    const unitIds = new Set(seedUnits.map((u) => u.id));
    const teachingIds = new Set(seedTeachings.map((t) => t.id));
    const versionIds = new Set(seedTimetableVersions.map((v) => v.id));

    // Venue owner
    for (const venue of seedVenues) {
      if (venue.ownerDepartmentId !== null) {
        expect(deptIds.has(venue.ownerDepartmentId)).toBe(true);
      }
    }

    // VenueUnavailabilities
    for (const vu of seedVenueUnavailabilities) {
      expect(venueIds.has(vu.venueId)).toBe(true);
    }

    // Users
    for (const user of seedUsers) {
      if (user.departmentId !== null) {
        expect(deptIds.has(user.departmentId)).toBe(true);
      }
      if (user.studentGroupId !== null) {
        expect(groupIds.has(user.studentGroupId)).toBe(true);
      }
    }

    // Lecturers
    for (const lecturer of seedLecturers) {
      expect(userIds.has(lecturer.userId)).toBe(true);
      expect(deptIds.has(lecturer.departmentId)).toBe(true);
    }

    // LecturerAvailabilities
    for (const la of seedLecturerAvailabilities) {
      expect(lecturerIds.has(la.lecturerId)).toBe(true);
    }

    // StudentGroups
    for (const group of seedStudentGroups) {
      expect(deptIds.has(group.departmentId)).toBe(true);
    }

    // Units
    for (const unit of seedUnits) {
      expect(deptIds.has(unit.departmentId)).toBe(true);
    }

    // Teachings
    for (const teaching of seedTeachings) {
      expect(unitIds.has(teaching.unitId)).toBe(true);
      expect(lecturerIds.has(teaching.lecturerId)).toBe(true);
      expect(groupIds.has(teaching.groupId)).toBe(true);
    }

    // Submissions
    for (const sub of seedSubmissions) {
      expect(deptIds.has(sub.departmentId)).toBe(true);
      if (sub.reviewerId !== null) {
        expect(userIds.has(sub.reviewerId)).toBe(true);
      }
    }

    // Issues
    for (const issue of seedIssues) {
      expect(deptIds.has(issue.departmentId)).toBe(true);
      if (issue.venueId !== null) {
        expect(venueIds.has(issue.venueId)).toBe(true);
      }
      if (issue.reportedBy !== null) {
        expect(userIds.has(issue.reportedBy)).toBe(true);
      }
    }

    // TimetableVersions
    for (const version of seedTimetableVersions) {
      expect(userIds.has(version.createdBy)).toBe(true);
    }

    // TimetableEntries
    for (const entry of seedTimetableEntries) {
      expect(versionIds.has(entry.versionId)).toBe(true);
      expect(teachingIds.has(entry.teachingId)).toBe(true);
      expect(venueIds.has(entry.venueId)).toBe(true);
    }
  });

  it("confirms SOEN 321 has no teaching and the three LAB units have venueTypeRequired LAB", () => {
    // SOEN 321 has no teaching
    const soen321Teachings = seedTeachings.filter(
      (t) => t.unitId === "unit-SOEN321"
    );
    expect(soen321Teachings).toHaveLength(0);

    // Exactly three units require LAB: SOEN 400, SOEN 407, SOEN 421
    const labUnits = seedUnits.filter((u) => u.venueTypeRequired === "LAB");
    expect(labUnits).toHaveLength(3);
    const labCodes = new Set(labUnits.map((u) => u.code));
    expect(labCodes).toEqual(new Set(["SOEN 400", "SOEN 407", "SOEN 421"]));
  });

  it("verifies the planted venue clash and lecturer clash pairs", () => {
    // Planted venue clash
    const v1 = seedTimetableEntries.find((e) => e.id === "entry-planted-venue-1");
    const v2 = seedTimetableEntries.find((e) => e.id === "entry-planted-venue-2");
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1!.venueId).toBe(v2!.venueId);
    expect(v1!.day).toBe(v2!.day);
    expect(v1!.start).toBe(v2!.start);
    expect(v1!.end).toBe(v2!.end);
    expect(v1!.teachingId).not.toBe(v2!.teachingId);

    // Planted lecturer clash
    const l1 = seedTimetableEntries.find((e) => e.id === "entry-planted-lecturer-1");
    const l2 = seedTimetableEntries.find((e) => e.id === "entry-planted-lecturer-2");
    expect(l1).toBeDefined();
    expect(l2).toBeDefined();

    const t1 = seedTeachings.find((t) => t.id === l1!.teachingId);
    const t2 = seedTeachings.find((t) => t.id === l2!.teachingId);
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1!.lecturerId).toBe(t2!.lecturerId);
    expect(l1!.day).toBe(l2!.day);
    expect(l1!.start).toBe(l2!.start);
    expect(l1!.end).toBe(l2!.end);
    expect(l1!.venueId).not.toBe(l2!.venueId);
  });

  it("verifies exactly 2 venues have no owner", () => {
    const unownedVenues = seedVenues.filter((v) => v.ownerDepartmentId === null);
    expect(unownedVenues).toHaveLength(2);
    expect(new Set(unownedVenues.map((v) => v.code))).toEqual(new Set(["GR1", "GR2"]));
  });
});
