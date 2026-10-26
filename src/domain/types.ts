import { z } from "zod";

/**
 * Domain types, enums, and constants for Kisii University TAMS.
 * Stored as plain strings in SQLite and validated via Zod per PROTOTYPE_SPEC §4 & §6.
 */

// User roles per PROTOTYPE_SPEC §8
export const USER_ROLES = [
  "ADMIN",
  "OFFICER",
  "DEPT_REP",
  "APPROVER",
  "LECTURER",
  "STUDENT",
] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Venue types per PROTOTYPE_SPEC §6 (HALL | ROOM | LAB)
export const VENUE_TYPES = ["HALL", "ROOM", "LAB"] as const;
export const VenueTypeSchema = z.enum(VENUE_TYPES);
export type VenueType = z.infer<typeof VenueTypeSchema>;

// Venue operational status
export const VENUE_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const;
export const VenueStatusSchema = z.enum(VENUE_STATUSES);
export type VenueStatus = z.infer<typeof VenueStatusSchema>;

// Submission workflow statuses per PROTOTYPE_SPEC §6 (DRAFT | SUBMITTED | RETURNED | APPROVED)
export const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
] as const;
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

// Timetable version statuses per PROTOTYPE_SPEC §6 (DRAFT | PUBLISHED | ARCHIVED)
export const TIMETABLE_VERSION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export const TimetableVersionStatusSchema = z.enum(TIMETABLE_VERSION_STATUSES);
export type TimetableVersionStatus = z.infer<typeof TimetableVersionStatusSchema>;

// Reschedule request statuses per PROTOTYPE_SPEC §6 & M6-T1
export const RESCHEDULE_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export const RescheduleStatusSchema = z.enum(RESCHEDULE_STATUSES);
export type RescheduleStatus = z.infer<typeof RescheduleStatusSchema>;

// Issue statuses per PROTOTYPE_SPEC §6 & M6-T2
export const ISSUE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;
export const IssueStatusSchema = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatusSchema>;

// Attendance session modes per PROTOTYPE_SPEC §6 (STATIC | ROTATING)
export const ATTENDANCE_SESSION_MODES = ["STATIC", "ROTATING"] as const;
export const AttendanceSessionModeSchema = z.enum(ATTENDANCE_SESSION_MODES);
export type AttendanceSessionMode = z.infer<typeof AttendanceSessionModeSchema>;

// Attendance session statuses
export const ATTENDANCE_SESSION_STATUSES = [
  "OPEN",
  "CLOSED",
  "CANCELLED",
] as const;
export const AttendanceSessionStatusSchema = z.enum(ATTENDANCE_SESSION_STATUSES);
export type AttendanceSessionStatus = z.infer<typeof AttendanceSessionStatusSchema>;

// Assumption feedback verdicts per PROTOTYPE_SPEC §6 & §9 (Confirm / Reject / Modify)
export const ASSUMPTION_VERDICTS = ["CONFIRM", "REJECT", "MODIFY"] as const;
export const AssumptionVerdictSchema = z.enum(ASSUMPTION_VERDICTS);
export type AssumptionVerdict = z.infer<typeof AssumptionVerdictSchema>;

// Days of week per PROTOTYPE_SPEC §7 (Mon-Fri)
export const DAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const DaySchema = z.enum(DAYS);
export type Day = z.infer<typeof DaySchema>;

// Aliases for backwards compatibility
export const DAYS_OF_WEEK = DAYS;
export const DayOfWeekSchema = DaySchema;
export type DayOfWeek = Day;

// Time in HH:MM 24-hour format
export const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TimeHHMMSchema = z
  .string()
  .regex(TIME_HHMM_REGEX, "Invalid time format, expected HH:MM (00:00 - 23:59)");
export type TimeHHMM = z.infer<typeof TimeHHMMSchema>;

/**
 * Checks if start time is strictly before end time in HH:MM format.
 * Returns false if either time string does not match HH:MM format or if start >= end.
 */
export function isStartBeforeEnd(start: string, end: string): boolean {
  if (!TIME_HHMM_REGEX.test(start) || !TIME_HHMM_REGEX.test(end)) {
    return false;
  }
  return start < end;
}
export const isTimeBefore = isStartBeforeEnd;

/**
 * SQLite helper to serialize and parse list fields such as Venue.facilities per PROTOTYPE_SPEC §4.
 */
export function serializeJsonFacilities(facilities: string[]): string {
  return JSON.stringify(facilities);
}

export function parseJsonFacilities(facilitiesJson: string): string[] {
  try {
    const parsed = JSON.parse(facilitiesJson);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}
