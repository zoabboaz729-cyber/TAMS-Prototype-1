/** Current published timetable service. M4-T4h enforces the trusted actor
 * scope before publication reads and again on every returned session. Currency
 * remains checked by the existing atomic adapter read transaction. */
import { decideAnyAccess } from "@/domain/access";
import type { Actor } from "@/domain/permissions";
import { canSelectTimetable, canReadTimetableEntry } from "@/domain/publishedTimetableAccess";
import { loadTimetableOptions, type TimetableOptions } from "@/server/publishedTimetableOptions";
import { DAYS } from "@/domain/types";
import {
  DEFAULT_SEMESTER,
  publishedTimetableInputMessage,
  PublishedTimetableRequestSchema,
  type DisplayableEntry,
  type PublishedEntryRow,
  type PublishedTimetableResult,
  type PublishedTimetableStore,
  type ViewingPerspective,
} from "@/server/publishedTimetableContract";

// ---------------------------------------------------------------------------
// Selection resolution
// ---------------------------------------------------------------------------

type SelectionOutcome =
  | { ok: true; view: ViewingPerspective; selectionId: string }
  | { ok: false; kind: "SELECTION_REQUIRED"; message: string }
  | { ok: false; kind: "SELECTION_NOT_FOUND"; view: ViewingPerspective; selectionId: string }
  | { ok: false; kind: "IDENTITY_UNRESOLVED"; message: string }
  | { ok: false; kind: "INVALID_INPUT"; message: string };

/** The lexicographically-first group id: a deterministic, documented prototype
 *  default for all-scope roles, not a verified university preference. */
function firstGroupId(groups: readonly { id: string }[]): string {
  return [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0].id;
}

/** Select only within the trusted options, never fall back to another identity. */
function resolveSelection(
  options: TimetableOptions,
  actor: Actor,
  view: ViewingPerspective | undefined,
  id: string | undefined,
): SelectionOutcome | { ok: false; kind: "FORBIDDEN" } {
  if (view === undefined && id !== undefined) {
    return { ok: false, kind: "INVALID_INPUT", message: "A selection id requires a perspective; choose a group, lecturer or venue view." };
  }
  if (actor.role === "STUDENT" && options.groups.length === 0) {
    return { ok: false, kind: "IDENTITY_UNRESOLVED", message: actor.studentGroupId === null
      ? "Your account is not linked to a student group. Ask the timetabling office to set your group."
      : "Your linked student group could not be found. Ask the timetabling office to check your enrolment." };
  }
  if (actor.role === "LECTURER" && options.lecturers.length === 0) {
    return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your account is not linked to a lecturer record. Ask the timetabling office to set up your lecturer profile." };
  }
  if ((actor.role === "DEPT_REP" || actor.role === "APPROVER") && !actor.departmentId) {
    return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your account is not linked to a department. Ask the timetabling office to set your department." };
  }
  if (view === undefined) {
    if (actor.role === "LECTURER") return { ok: true, view: "lecturer", selectionId: options.lecturers[0].id };
    if (options.groups.length === 0) return { ok: false, kind: "SELECTION_REQUIRED", message: "No student group is available to display. Ask the timetabling office to add authorized groups, then choose a view." };
    return { ok: true, view: "group", selectionId: firstGroupId(options.groups) };
  }
  if (!options.access.perspectives.includes(view)) return { ok: false, kind: "FORBIDDEN" };
  if (id === undefined) return { ok: false, kind: "SELECTION_REQUIRED", message: `Choose a specific ${view} to display its published timetable.` };
  if (!canSelectTimetable(options.access, view, id)) return { ok: false, kind: "FORBIDDEN" };
  const choices = view === "group" ? options.groups : view === "lecturer" ? options.lecturers : options.venues;
  if (!choices.some(row => row.id === id)) return { ok: false, kind: "SELECTION_NOT_FOUND", view, selectionId: id };
  return { ok: true, view, selectionId: id };
}

// ---------------------------------------------------------------------------
// Projection, integrity and deterministic ordering
// ---------------------------------------------------------------------------

/** A joined field is present only when it is non-null and not blank. */
function present(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

/** Real stored relationships only: null when any required relation is missing,
 *  so the caller fails closed instead of fabricating a name or dropping a row. */
function projectEntry(entry: PublishedEntryRow): DisplayableEntry | null {
  const { unitCode, unitTitle, groupId, groupName, lecturerId, lecturerName, venueCode } = entry;
  if (
    !present(unitCode) || !present(unitTitle) || !present(groupId) || !present(groupName) ||
    !present(lecturerId) || !present(lecturerName) || !present(venueCode)
  ) {
    return null;
  }
  return {
    id: entry.id, versionId: entry.versionId, day: entry.day, start: entry.start, end: entry.end,
    teachingId: entry.teachingId, unitCode, unitTitle, groupId, groupName, lecturerId, lecturerName,
    venueId: entry.venueId, venueCode,
  };
}

function matchesView(entry: DisplayableEntry, view: ViewingPerspective, selectionId: string): boolean {
  if (view === "group") return entry.groupId === selectionId;
  if (view === "lecturer") return entry.lecturerId === selectionId;
  return entry.venueId === selectionId;
}

/** Week order — domain day sequence, then start time, then id — whatever order
 *  the store returned. A day outside the grid sorts last, deterministically. */
function sortEntries(entries: readonly DisplayableEntry[]): DisplayableEntry[] {
  const dayRank = new Map<string, number>(DAYS.map((day, index) => [day, index]));
  const unlisted = DAYS.length;
  return [...entries].sort((a, b) => {
    const rankA = dayRank.get(a.day) ?? unlisted;
    const rankB = dayRank.get(b.day) ?? unlisted;
    if (rankA !== rankB) return rankA - rankB;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}

const NO_PUBLICATION_TIME = "The current published timetable has no publication time recorded, so its state is inconsistent. Ask the timetabling office to republish it.";

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Read the current published timetable for one perspective, or refuse with a
 * typed reason. Order: session -> VIEW_TIMETABLE -> request shape -> selection ->
 * current version -> one atomic consistent entry read -> projection -> filter.
 * `request` is untrusted (e.g. page search params) and validated here.
 */
export async function readPublishedTimetable(
  store: PublishedTimetableStore,
  actor: Actor | null,
  request: unknown,
): Promise<PublishedTimetableResult> {
  // Authorization before anything else: a denied caller provably causes zero reads.
  if (actor === null) return { ok: false, kind: "UNAUTHENTICATED" };
  if (decideAnyAccess(actor, "VIEW_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const parsed = PublishedTimetableRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: publishedTimetableInputMessage(parsed.error) };
  }
  const semester = parsed.data.semester ?? DEFAULT_SEMESTER;
  if (actor.role === "STUDENT" && actor.studentGroupId === null) {
    return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your account is not linked to a student group. Ask the timetabling office to set your group." };
  }

  try {
    const options = await loadTimetableOptions(store, actor, semester);
    const selection = resolveSelection(options, actor, parsed.data.view, parsed.data.id);
    if (!selection.ok) return selection;

    // Resolve the current version. The query is PUBLISHED-and-semester scoped, so
    // any row outside that scope is a broken read and fails closed.
    const rows = await store.listPublishedVersionsBySemester(semester);
    for (const row of rows) {
      if (row.semester !== semester || row.status !== "PUBLISHED") {
        throw new Error("published-version read returned out-of-scope rows");
      }
    }
    if (rows.length === 0) return { ok: false, kind: "NO_PUBLISHED_VERSION", semester };
    if (rows.length > 1) return { ok: false, kind: "AMBIGUOUS_PUBLISHED_VERSION", semester };
    const candidate = rows[0];
    if (candidate.publishedAt === null) {
      return { ok: false, kind: "INVALID_PUBLISHED_DATA", message: NO_PUBLICATION_TIME };
    }

    // The consistency boundary: one atomic read that re-confirms currency. A
    // publication since the resolution above is STALE, never an outdated result.
    const read = await store.readPublishedEntries(candidate.id, semester);
    if (read.status === "stale") return { ok: false, kind: "STALE", semester };
    const version = read.version;
    if (version.id !== candidate.id || version.semester !== semester || version.status !== "PUBLISHED") {
      throw new Error("consistent read returned a version that is not the current publication");
    }
    if (version.publishedAt === null) {
      return { ok: false, kind: "INVALID_PUBLISHED_DATA", message: NO_PUBLICATION_TIME };
    }

    // Re-filter to the chosen version even though the read is version-scoped, so a
    // broken store cannot leak another version's entries into the result.
    const own = read.entries.filter((entry) => entry.versionId === version.id);
    const projected: DisplayableEntry[] = [];
    for (const entry of own) {
      if (!canReadTimetableEntry(options.access, actor, { groupId: entry.groupId ?? "", lecturerId: entry.lecturerId ?? "" })) continue;
      const item = projectEntry(entry);
      if (item === null) {
        return { ok: false, kind: "INVALID_PUBLISHED_DATA", message: `Published entry ${entry.id} is missing required unit, group, lecturer or venue details. Ask the timetabling office to correct and republish it.` };
      }
      projected.push(item);
    }

    // Enforce the perspective here regardless of any adapter-side SQL filtering.
    const entries = sortEntries(projected.filter((entry) => matchesView(entry, selection.view, selection.selectionId)));
    return {
      ok: true,
      version: { id: version.id, semester: version.semester, publishedAt: version.publishedAt },
      view: selection.view,
      selectionId: selection.selectionId,
      semester,
      entries,
    };
  } catch {
    // One fixed, non-sensitive line: a caught exception can carry SQL, a file path
    // or a connection string, so nothing derived from it reaches the log or client.
    console.error("[publishedTimetable] read failed; returning INTERNAL_ERROR");
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}