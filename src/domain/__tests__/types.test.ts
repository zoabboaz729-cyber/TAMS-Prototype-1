import { describe, it, expect } from "vitest";
import {
  USER_ROLES,
  UserRoleSchema,
  VENUE_TYPES,
  VenueTypeSchema,
  VENUE_STATUSES,
  VenueStatusSchema,
  SUBMISSION_STATUSES,
  SubmissionStatusSchema,
  TIMETABLE_VERSION_STATUSES,
  TimetableVersionStatusSchema,
  RESCHEDULE_STATUSES,
  RescheduleStatusSchema,
  ISSUE_STATUSES,
  IssueStatusSchema,
  ATTENDANCE_SESSION_MODES,
  AttendanceSessionModeSchema,
  ATTENDANCE_SESSION_STATUSES,
  AttendanceSessionStatusSchema,
  ASSUMPTION_VERDICTS,
  AssumptionVerdictSchema,
  DAYS,
  DaySchema,
  DAYS_OF_WEEK,
  DayOfWeekSchema,
  TimeHHMMSchema,
  isStartBeforeEnd,
  serializeJsonFacilities,
  parseJsonFacilities,
} from "../types";

describe("Domain Enums and Types Validation", () => {
  it("validates UserRoleSchema accepts all valid roles and rejects invalid", () => {
    for (const role of USER_ROLES) {
      expect(UserRoleSchema.parse(role)).toBe(role);
    }
    expect(UserRoleSchema.safeParse("INVALID_ROLE").success).toBe(false);
  });

  it("validates VenueTypeSchema accepts all valid venue types and rejects invalid", () => {
    for (const type of VENUE_TYPES) {
      expect(VenueTypeSchema.parse(type)).toBe(type);
    }
    expect(VenueTypeSchema.safeParse("STADIUM").success).toBe(false);
  });

  it("validates VenueStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of VENUE_STATUSES) {
      expect(VenueStatusSchema.parse(status)).toBe(status);
    }
    expect(VenueStatusSchema.safeParse("DESTROYED").success).toBe(false);
  });

  it("validates SubmissionStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(SubmissionStatusSchema.parse(status)).toBe(status);
    }
    expect(SubmissionStatusSchema.safeParse("CANCELLED").success).toBe(false);
  });

  it("validates TimetableVersionStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of TIMETABLE_VERSION_STATUSES) {
      expect(TimetableVersionStatusSchema.parse(status)).toBe(status);
    }
    expect(TimetableVersionStatusSchema.safeParse("DEPRECATED").success).toBe(false);
  });

  it("validates RescheduleStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of RESCHEDULE_STATUSES) {
      expect(RescheduleStatusSchema.parse(status)).toBe(status);
    }
    expect(RescheduleStatusSchema.safeParse("POSTPONED").success).toBe(false);
  });

  it("validates IssueStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of ISSUE_STATUSES) {
      expect(IssueStatusSchema.parse(status)).toBe(status);
    }
    expect(IssueStatusSchema.safeParse("IGNORED").success).toBe(false);
  });

  it("validates AttendanceSessionModeSchema accepts valid modes and rejects invalid", () => {
    for (const mode of ATTENDANCE_SESSION_MODES) {
      expect(AttendanceSessionModeSchema.parse(mode)).toBe(mode);
    }
    expect(AttendanceSessionModeSchema.safeParse("HYBRID").success).toBe(false);
  });

  it("validates AttendanceSessionStatusSchema accepts valid statuses and rejects invalid", () => {
    for (const status of ATTENDANCE_SESSION_STATUSES) {
      expect(AttendanceSessionStatusSchema.parse(status)).toBe(status);
    }
    expect(AttendanceSessionStatusSchema.safeParse("PAUSED").success).toBe(false);
  });

  it("validates AssumptionVerdictSchema accepts valid verdicts and rejects invalid", () => {
    for (const verdict of ASSUMPTION_VERDICTS) {
      expect(AssumptionVerdictSchema.parse(verdict)).toBe(verdict);
    }
    expect(AssumptionVerdictSchema.safeParse("MAYBE").success).toBe(false);
  });

  it("validates DaySchema accepts valid days and rejects invalid", () => {
    for (const day of DAYS) {
      expect(DaySchema.parse(day)).toBe(day);
    }
    expect(DaySchema.safeParse("SATURDAY").success).toBe(false);
    expect(DaySchema.safeParse("SUN").success).toBe(false);
    expect(DaySchema.safeParse("mon").success).toBe(false);
  });

  it("validates DayOfWeekSchema accepts valid days and rejects invalid", () => {
    for (const day of DAYS_OF_WEEK) {
      expect(DayOfWeekSchema.parse(day)).toBe(day);
    }
    expect(DayOfWeekSchema.safeParse("SATURDAY").success).toBe(false);
  });

  it("validates TimeHHMMSchema with valid, boundary, and invalid values", () => {
    // Valid values
    expect(TimeHHMMSchema.parse("08:00")).toBe("08:00");
    expect(TimeHHMMSchema.parse("13:45")).toBe("13:45");
    expect(TimeHHMMSchema.parse("17:00")).toBe("17:00");

    // Boundary values
    expect(TimeHHMMSchema.parse("00:00")).toBe("00:00");
    expect(TimeHHMMSchema.parse("23:59")).toBe("23:59");

    // Invalid values required by spec
    expect(TimeHHMMSchema.safeParse("8:00").success).toBe(false);
    expect(TimeHHMMSchema.safeParse("24:00").success).toBe(false);
    expect(TimeHHMMSchema.safeParse("08:60").success).toBe(false);

    // Other malformed inputs
    expect(TimeHHMMSchema.safeParse("").success).toBe(false);
    expect(TimeHHMMSchema.safeParse("abc").success).toBe(false);
    expect(TimeHHMMSchema.safeParse("-01:00").success).toBe(false);
  });

  it("checks isStartBeforeEnd helper handles normal, boundary, and invalid times", () => {
    // Normal cases
    expect(isStartBeforeEnd("08:00", "10:00")).toBe(true);
    expect(isStartBeforeEnd("13:00", "14:00")).toBe(true);

    // Boundary cases
    expect(isStartBeforeEnd("00:00", "23:59")).toBe(true);
    expect(isStartBeforeEnd("00:00", "00:01")).toBe(true);
    expect(isStartBeforeEnd("23:58", "23:59")).toBe(true);

    // Equal times (not strictly before)
    expect(isStartBeforeEnd("10:00", "10:00")).toBe(false);
    expect(isStartBeforeEnd("00:00", "00:00")).toBe(false);

    // Inverted times (start after end)
    expect(isStartBeforeEnd("10:00", "08:00")).toBe(false);
    expect(isStartBeforeEnd("23:59", "00:00")).toBe(false);

    // Invalid inputs
    expect(isStartBeforeEnd("8:00", "10:00")).toBe(false);
    expect(isStartBeforeEnd("08:00", "24:00")).toBe(false);
    expect(isStartBeforeEnd("24:00", "08:60")).toBe(false);
  });

  it("serializes and parses facilities JSON list correctly", () => {
    const facilities = ["projector", "whiteboard", "air_conditioning"];
    const json = serializeJsonFacilities(facilities);
    expect(parseJsonFacilities(json)).toEqual(facilities);
    expect(parseJsonFacilities("invalid json")).toEqual([]);
    expect(parseJsonFacilities("123")).toEqual([]);
  });
});
