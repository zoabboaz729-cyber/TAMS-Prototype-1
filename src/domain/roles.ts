import { UserRole } from "./types";

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  OFFICER: "Timetabling Officer",
  DEPT_REP: "Department Rep",
  APPROVER: "Head of Department",
  LECTURER: "Lecturer",
  STUDENT: "Student",
};

/**
 * Returns the display label for a valid role, or the raw string otherwise.
 * Never throws — uses Object.hasOwn so "__proto__" / "toString" lookups are safe.
 * Single source of truth for role labels; layout.tsx, page.tsx and
 * DemoSwitcher.tsx import from here.
 */
export function roleLabel(role: string): string {
  if (Object.hasOwn(ROLE_LABEL, role)) {
    return ROLE_LABEL[role as UserRole];
  }
  return role;
}