/** Server read orchestration only; pure authorization lives in the domain.
 * Returns only choices this actor may see. No URL identity is accepted here. */
import type { Actor } from "@/domain/permissions";
import { timetableAccess, type TimetableAccess } from "@/domain/publishedTimetableAccess";
import type { PublishedTimetableStore, StudentGroupChoice, LecturerChoice, VenueChoice } from "./publishedTimetableContract";

export type TimetableOptions = {
  groups: StudentGroupChoice[];
  lecturers: LecturerChoice[];
  venues: VenueChoice[];
  access: TimetableAccess;
};

export async function loadTimetableOptions(store: PublishedTimetableStore, actor: Actor, semester: number): Promise<TimetableOptions> {
  const groups = await store.listStudentGroups();
  let lecturers: LecturerChoice[] = [];
  let venues: VenueChoice[] = [];
  let teachings: { groupId: string; lecturerId: string }[] = [];
  if (actor.role === "OFFICER" || actor.role === "ADMIN") {
    [lecturers, venues] = await Promise.all([store.listLecturers(), store.listVenues()]);
  } else if (actor.role === "LECTURER") {
    const own = await store.findLecturerByUserId(actor.id);
    // Verify even the injected store's identity relation before granting access.
    lecturers = own !== null && own.userId === actor.id ? [own] : [];
    if (lecturers.length > 0) teachings = await store.listTeachingAccess(semester);
  } else if ((actor.role === "DEPT_REP" || actor.role === "APPROVER") && actor.departmentId) {
    [lecturers, teachings] = await Promise.all([store.listLecturers(), store.listTeachingAccess(semester)]);
  }
  const access = timetableAccess(actor, groups, lecturers, teachings);
  return {
    groups: groups.filter(g => access.groupIds.includes(g.id)),
    lecturers: lecturers.filter(l => access.lecturerIds.includes(l.id)),
    venues: access.unrestricted ? venues : [], access,
  };
}
