/**
 * Pure permission matrix for Kisii University TAMS (PROTOTYPE_SPEC §8).
 *
 * Deny by default: every role/action cell not marked as granted is NONE,
 * and canAct() returns false for NONE scopes, missing actors, and unknown
 * roles/actions cast in at runtime — it never throws.
 *
 * No database, network, Next.js, or clock dependencies. Business logic is
 * a pure lookup plus pure scope checks, so it is fully unit-testable.
 */

import { UserRole, USER_ROLES } from "./types";

export const ACTIONS = [
  "MANAGE_USERS",
  "DECLARE_VENUE",
  "MANAGE_SHARED_VENUES",
  "EDIT_SUBMISSION",
  "REVIEW_SUBMISSION",
  "GENERATE_TIMETABLE",
  "EDIT_DRAFT",
  "PUBLISH_TIMETABLE",
  "REQUEST_RESCHEDULE",
  "DECIDE_RESCHEDULE",
  "REPORT_ISSUE",
  "OPEN_ATTENDANCE",
  "SCAN_ATTENDANCE",
  "VIEW_TIMETABLE",
  "VIEW_VENUE_STATUS",
  "VIEW_ATTENDANCE_REPORT",
  "SEE_ISSUES",
] as const;
export type Action = (typeof ACTIONS)[number];

export const SCOPES = [
  "NONE",
  "ALL",
  "OWN_DEPARTMENT",
  "OWN_CLASSES",
  "OWN_GROUP",
  "SELF",
] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * One explicit lookup table covering every role and every action.
 * Typed as Record<UserRole, Record<Action, Scope>>, so a missing or
 * extra cell is a compile-time error: no defaults, no fall-through.
 * Values taken from PROTOTYPE_SPEC §8 (SEE_ISSUES added per task M1-T3c-1).
 */
export const PERMISSION_SCOPE: Record<UserRole, Record<Action, Scope>> = {
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

/**
 * Scope a role has for an action. Unknown roles/actions passed at runtime
 * (e.g. via a cast) yield NONE instead of throwing.
 */
export function permissionScope(role: UserRole, action: Action): Scope {
  if (!USER_ROLES.includes(role)) return "NONE";
  if (!ACTIONS.includes(action)) return "NONE";
  return PERMISSION_SCOPE[role][action];
}

export type Actor = {
  id: string;
  role: UserRole;
  departmentId: string | null;
  studentGroupId: string | null;
};

export type Resource = {
  departmentId?: string | null;
  ownerUserId?: string | null;
  groupId?: string | null;
  subjectUserId?: string | null;
};

/**
 * Resolve a scope to a boolean decision. Deny by default:
 *  * null actor -> false
 *  * NONE scope -> false
 *  * ALL scope -> true
 *  * OWN_DEPARTMENT -> true only if actor.departmentId is not null and
 *    resource.departmentId is defined, non-null, and equal to it
 *  * OWN_CLASSES -> true only if resource.ownerUserId is defined,
 *    non-null, and equals actor.id
 *  * OWN_GROUP -> true only if actor.studentGroupId is not null and
 *    resource.groupId is defined, non-null, and equals it
 *  * SELF -> true only if resource.subjectUserId is defined,
 *    non-null, and equals actor.id
 * A missing or null required resource field -> false.
 * Never throws.
 */
export function canAct(actor: Actor | null, action: Action, resource?: Resource): boolean {
  if (actor === null) return false;

  const scope = permissionScope(actor.role, action);

  switch (scope) {
    case "NONE":
      return false;
    case "ALL":
      return true;
    case "OWN_DEPARTMENT":
      return (
        actor.departmentId !== null &&
        resource !== undefined &&
        resource.departmentId !== undefined &&
        resource.departmentId !== null &&
        resource.departmentId === actor.departmentId
      );
    case "OWN_CLASSES":
      return (
        resource !== undefined &&
        resource.ownerUserId !== undefined &&
        resource.ownerUserId !== null &&
        resource.ownerUserId === actor.id
      );
    case "OWN_GROUP":
      return (
        actor.studentGroupId !== null &&
        resource !== undefined &&
        resource.groupId !== undefined &&
        resource.groupId !== null &&
        resource.groupId === actor.studentGroupId
      );
    case "SELF":
      return (
        resource !== undefined &&
        resource.subjectUserId !== undefined &&
        resource.subjectUserId !== null &&
        resource.subjectUserId === actor.id
      );
    default:
      // Unknown scope at runtime (e.g. cast in): deny, never throw.
      return false;
  }
}

/**
 * Actions granted to a role (scope is not NONE). Used later to build menus.
 */
export function allowedActions(role: UserRole): Action[] {
  return ACTIONS.filter((action) => permissionScope(role, action) !== "NONE");
}