/** M4-T4h security contract. Relationships are supplied by trusted stored data,
 * never URL claims. Department relevance follows the student group's department,
 * including service teaching by staff from other departments. */
import type { Actor } from "./permissions";

export type TimetablePerspective = "group" | "lecturer" | "venue";
export type TimetableGroup = { id: string; departmentId?: string };
export type TimetableLecturer = { id: string; userId: string };
export type TimetableTeaching = { groupId: string; lecturerId: string };
export type TimetableAccess = {
  perspectives: readonly TimetablePerspective[];
  groupIds: readonly string[];
  lecturerIds: readonly string[];
  unrestricted: boolean;
};

/** ADMIN explicitly retains read-only scheduling oversight, not mutation rights.
 * A lecturer's group perspective contains ONLY that lecturer's sessions. */
export function timetableAccess(
  actor: Actor,
  groups: readonly TimetableGroup[],
  lecturers: readonly TimetableLecturer[],
  teachings: readonly TimetableTeaching[],
): TimetableAccess {
  const denied: TimetableAccess = { perspectives: [], groupIds: [], lecturerIds: [], unrestricted: false };
  if (actor.role === "OFFICER" || actor.role === "ADMIN") {
    return { perspectives: ["group", "lecturer", "venue"], groupIds: groups.map(g => g.id), lecturerIds: lecturers.map(l => l.id), unrestricted: true };
  }
  if (actor.role === "STUDENT") {
    return { ...denied, perspectives: ["group"], groupIds: groups.filter(g => g.id === actor.studentGroupId).map(g => g.id) };
  }
  if (actor.role === "LECTURER") {
    const own = lecturers.filter(l => l.userId === actor.id).map(l => l.id);
    const taught = new Set(teachings.filter(t => own.includes(t.lecturerId)).map(t => t.groupId));
    return { ...denied, perspectives: ["group", "lecturer"], lecturerIds: own, groupIds: groups.filter(g => taught.has(g.id)).map(g => g.id) };
  }
  if (actor.role === "DEPT_REP" || actor.role === "APPROVER") {
    if (!actor.departmentId) return denied;
    const own = groups.filter(g => g.departmentId === actor.departmentId).map(g => g.id);
    const relevant = new Set(teachings.filter(t => own.includes(t.groupId)).map(t => t.lecturerId));
    return { ...denied, perspectives: ["group", "lecturer"], groupIds: own, lecturerIds: lecturers.filter(l => relevant.has(l.id)).map(l => l.id) };
  }
  return denied;
}

export function canSelectTimetable(access: TimetableAccess, view: TimetablePerspective, id: string): boolean {
  if (!access.perspectives.includes(view)) return false;
  if (access.unrestricted) return true; // Existence is checked separately.
  if (view === "group") return access.groupIds.includes(id);
  if (view === "lecturer") return access.lecturerIds.includes(id);
  return false;
}

/** Rechecked on every projected row, including lecturer views for a department
 * and group views for a lecturer, to prevent indirect cross-scope disclosure. */
export function canReadTimetableEntry(access: TimetableAccess, actor: Actor, entry: TimetableTeaching): boolean {
  if (access.unrestricted) return true;
  if (actor.role === "LECTURER") return access.lecturerIds.includes(entry.lecturerId);
  return access.groupIds.includes(entry.groupId);
}
