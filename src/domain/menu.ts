/**
 * Role-based navigation menu for Kisii University TAMS (task M1-T3c-4).
 *
 * Pure domain module: no Next.js, no database, no clock, never throws.
 *
 * - `MENU_ITEMS` is in sidebar order; the `built` flag is false until the
 *   page is delivered and flipped to `true` by that task (see DECISIONS.md).
 * - `PUBLISH_TIMETABLE` and `MANAGE_SHARED_VENUES` deliberately have no
 *   menu entry — they live inside other pages.
 * - `menuForRole(role)` returns, in `MENU_ITEMS` order, the items whose
 *   `permissionScope(role, action)` is not "NONE" and whose `audienceRoles`
 *   (when set) include the role. Unknown roles (e.g. cast in at runtime)
 *   yield an empty menu.
 */

import { type UserRole } from "./types";
import { Action, permissionScope } from "./permissions";

export type MenuItem = {
  key: string;
  label: string;
  href: string;
  action: Action;
  built: boolean;
  /**
   * Optional sidebar audience override. `menuForRole` normally filters by
   * `permissionScope(role, action) !== "NONE"`, but "My availability" is a
   * lecturer workspace while VIEW_LECTURER_AVAILABILITY is ALL-scope for
   * officers/admins (they read availability in the service, not in a menu).
   * This field narrows the NAVIGATION only — it never grants or denies
   * anything; server guards remain the sole enforcement point.
   */
  audienceRoles?: readonly UserRole[];
};

export const MENU_ITEMS: readonly MenuItem[] = [
  { key: "timetable", label: "Timetable", href: "/timetable", action: "VIEW_TIMETABLE", built: true },
  { key: "venue-status", label: "Venue status", href: "/venues/status", action: "VIEW_VENUE_STATUS", built: true },
  { key: "venue-register", label: "Venue register", href: "/venues", action: "DECLARE_VENUE", built: true },
  { key: "submission-edit", label: "Department submission", href: "/department/submission", action: "EDIT_SUBMISSION", built: true },
  { key: "submission-review", label: "Review submissions", href: "/department/review", action: "REVIEW_SUBMISSION", built: true },
  { key: "submission-overview", label: "Department submissions", href: "/officer/submissions", action: "VIEW_SUBMISSIONS", built: true },
  { key: "draft-editor", label: "Draft editor", href: "/officer/draft", action: "EDIT_DRAFT", built: true },
  { key: "generate", label: "Generate timetable", href: "/officer/generate", action: "GENERATE_TIMETABLE", built: false },
  { key: "reschedule-decide", label: "Reschedule requests", href: "/officer/reschedules", action: "DECIDE_RESCHEDULE", built: false },
  { key: "reschedule-request", label: "Request a reschedule", href: "/lecturer/reschedule", action: "REQUEST_RESCHEDULE", built: false },
  { key: "lecturer-availability", label: "My availability", href: "/lecturer/availability", action: "VIEW_LECTURER_AVAILABILITY", built: true, audienceRoles: ["LECTURER"] },
  { key: "issues-new", label: "Report an issue", href: "/issues/new", action: "REPORT_ISSUE", built: false },
  { key: "issues-list", label: "Issues", href: "/issues", action: "SEE_ISSUES", built: false },
  { key: "attendance-open", label: "Open attendance", href: "/lecturer/attendance", action: "OPEN_ATTENDANCE", built: false },
  { key: "attendance-scan", label: "Scan attendance", href: "/student/scan", action: "SCAN_ATTENDANCE", built: false },
  { key: "attendance-report", label: "Attendance reports", href: "/reports/attendance", action: "VIEW_ATTENDANCE_REPORT", built: false },
  { key: "users", label: "Manage users", href: "/admin/users", action: "MANAGE_USERS", built: false },
];

/**
 * Menu items for a role, in MENU_ITEMS order, filtered to granted actions
 * (and, where set, to the item's audienceRoles). Unknown roles passed at
 * runtime return [] — never throw.
 */
export function menuForRole(role: UserRole): MenuItem[] {
  return MENU_ITEMS.filter(
    (item) =>
      permissionScope(role, item.action) !== "NONE" &&
      (item.audienceRoles === undefined || item.audienceRoles.includes(role)),
  );
}
