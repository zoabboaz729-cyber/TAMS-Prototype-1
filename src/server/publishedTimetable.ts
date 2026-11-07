/**
 * Read-only orchestration for the current published timetable (M4-T4a) by group,
 * lecturer or venue. The injected store, request shape and typed result live in
 * `publishedTimetableContract.ts`; the Prisma adapter is M4-T4b. Nothing here
 * touches a database, imports Prisma or the db singleton, or reads a clock.
 *
 * Rules enforced here, never in the UI:
 * - VIEW_TIMETABLE is decided BEFORE any store call, so an unauthenticated or
 *   forbidden caller triggers zero reads. The actor comes from the trusted
 *   server-side caller only; the request schema is `.strict()`, so a forged
 *   versionId, role, department or privilege is refused as INVALID_INPUT first.
 * - The service resolves the current version itself from the semester's PUBLISHED
 *   set: zero -> NO_PUBLISHED_VERSION, more than one -> AMBIGUOUS_PUBLISHED_VERSION
 *   (never broken by createdAt, publishedAt or lexical id order). Rows outside the
 *   requested semester or with a status other than PUBLISHED fail closed.
 * - Role-aware defaults: a student gets their session group, a lecturer their own
 *   Lecturer record, and every all-scope role a deterministic available group. A
 *   missing identity refuses (IDENTITY_UNRESOLVED); no available group refuses
 *   (SELECTION_REQUIRED). An explicit view must carry an id and exist; a named
 *   view without an id asks for a selection and never substitutes another view.
 * - Currency is claimed only from `readPublishedEntries`, the store's one atomic
 *   read transaction that re-checks the version is still current before returning
 *   its entries. A publication between the resolution and that read is STALE,
 *   never a mixed or outdated "current" timetable.
 * - Entries are re-filtered to the chosen version even though the read is
 *   version-scoped, so a broken store cannot leak another version's rows. Every
 *   entry must carry real unit, group, lecturer and venue data; a missing relation
 *   is INVALID_PUBLISHED_DATA, never a synthesized name or a silently dropped row.
 *   The selection filter is enforced here regardless of any adapter-side filtering.
 * - A store failure throws and becomes INTERNAL_ERROR with one fixed, non-sensitive
 *   log line; no exception text, SQL or connection detail reaches the log or client.
 */
import { decideAccess } from "@/domain/access";
import type { Actor } from "@/domain/permissions";
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

async function selectionExists(
  store: PublishedTimetableStore,
  view: ViewingPerspective,
  id: string,
): Promise<boolean> {
  if (view === "group") return (await store.listStudentGroups()).some((row) => row.id === id);
  if (view === "lecturer") return (await store.listLecturers()).some((row) => row.id === id);
  return (await store.listVenues()).some((row) => row.id === id);
}

/** Both selection fields omitted: derive the perspective from the actor's role. */
async function roleDefault(
  store: PublishedTimetableStore,
  actor: Actor,
): Promise<SelectionOutcome> {
  if (actor.role === "STUDENT") {
    const groupId = actor.studentGroupId;
    if (groupId === null) {
      return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your account is not linked to a student group. Ask the timetabling office to set your group." };
    }
    if (!(await selectionExists(store, "group", groupId))) {
      return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your linked student group could not be found. Ask the timetabling office to check your enrolment." };
    }
    return { ok: true, view: "group", selectionId: groupId };
  }
  if (actor.role === "LECTURER") {
    const lecturer = await store.findLecturerByUserId(actor.id);
    if (lecturer === null) {
      return { ok: false, kind: "IDENTITY_UNRESOLVED", message: "Your account is not linked to a lecturer record. Ask the timetabling office to set up your lecturer profile." };
    }
    return { ok: true, view: "lecturer", selectionId: lecturer.id };
  }
  // OFFICER, ADMIN, DEPT_REP, APPROVER all hold ALL scope: a deterministic group.
  const groups = await store.listStudentGroups();
  if (groups.length === 0) {
    return { ok: false, kind: "SELECTION_REQUIRED", message: "No student group is available to display. Ask the timetabling office to add groups, then choose a view." };
  }
  return { ok: true, view: "group", selectionId: firstGroupId(groups) };
}

/**
 * View and id must be provided together. Both omitted -> role default; a named
 * view without an id -> SELECTION_REQUIRED (never a different perspective); an id
 * without a view -> INVALID_INPUT; both present -> a verified explicit selection.
 */
async function resolveSelection(
  store: PublishedTimetableStore,
  actor: Actor,
  view: ViewingPerspective | undefined,
  id: string | undefined,
): Promise<SelectionOutcome> {
  if (view === undefined) {
    if (id === undefined) return roleDefault(store, actor);
    return { ok: false, kind: "INVALID_INPUT", message: "A selection id requires a perspective; choose a group, lecturer or venue view." };
  }
  if (id === undefined) {
    return { ok: false, kind: "SELECTION_REQUIRED", message: `Choose a specific ${view} to display its published timetable.` };
  }
  if (!(await selectionExists(store, view, id))) {
    return { ok: false, kind: "SELECTION_NOT_FOUND", view, selectionId: id };
  }
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
  if (decideAccess(actor, "VIEW_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const parsed = PublishedTimetableRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: publishedTimetableInputMessage(parsed.error) };
  }
  const semester = parsed.data.semester ?? DEFAULT_SEMESTER;

  try {
    const selection = await resolveSelection(store, actor, parsed.data.view, parsed.data.id);
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