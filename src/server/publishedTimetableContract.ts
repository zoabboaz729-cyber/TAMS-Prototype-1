/**
 * Read contract for the current published timetable (M4-T4a): the injected
 * read-only store, the request shape, the displayable projection and the typed
 * result. Behaviour lives in `publishedTimetable.ts`; the Prisma adapter is
 * M4-T4b. Nothing here imports Prisma, the db singleton, Next.js or a clock.
 *
 * Contract guarantees (each one is asserted by the service tests):
 * - The request carries only `semester`, `view` and `id`. `PublishedTimetableRequestSchema`
 *   is `.strict()`, so a forged `versionId`, actor, role, department or privilege
 *   key fails as INVALID_INPUT before a single read. The current version is
 *   resolved by the service, never chosen by a request field.
 * - VIEW_TIMETABLE is decided before any store method. The actor comes from the
 *   trusted server-side caller only. M4-T4h restricts resources using stored group ownership and semester teaching
 *   relationships. Page entry alone grants no per-record authority.
 * - Reads are separate from any write — there is no write method on this store.
 *   A read that cannot be answered must throw so the service reports INTERNAL_ERROR
 *   instead of presenting an empty timetable it never really read.
 * - `readPublishedEntries` is the consistency boundary. The adapter MUST run it in
 *   ONE read transaction: re-read the semester's PUBLISHED versions, confirm
 *   `versionId` is still the unique current one with a non-null `publishedAt`, then
 *   read that version's entries and joins, and return them together as
 *   `{ status: "current" }`. If the version is no longer the unique current
 *   publication it returns `{ status: "stale" }`. The service's earlier
 *   `listPublishedVersionsBySemester` resolution is NOT claimed to be atomic with
 *   this read; only this method's version+entries+currency re-check is, so a
 *   publication between the two reads is reported as STALE, never as a mixed or
 *   outdated "current" timetable (DECISIONS.md M4-T4a).
 * - Joined display fields are nullable: a missing unit, group, lecturer or venue
 *   is a data-integrity failure the service reports, never a synthesized name and
 *   never a silently dropped entry.
 */
import { z } from "zod";
import type { TimetableVersionStatus } from "@/domain/types";

// ---------------------------------------------------------------------------
// Request: perspective, semester and the strict request shape
// ---------------------------------------------------------------------------

export const VIEWING_PERSPECTIVES = ["group", "lecturer", "venue"] as const;
export const ViewingPerspectiveSchema = z.enum(VIEWING_PERSPECTIVES);
export type ViewingPerspective = z.infer<typeof ViewingPerspectiveSchema>;

/** ASSUMPTION-8: the prototype knows semesters 1 and 2 only. */
export const PublishedSemesterSchema = z.number().int().min(1).max(2);

/**
 * Prototype default when the request omits `semester`: semester 1. This is a
 * design choice for the demo, NOT a verified university calendar policy
 * (DECISIONS.md M4-T4a); the supported values themselves follow ASSUMPTION-8.
 */
export const DEFAULT_SEMESTER = 1;

export const PublishedTimetableRequestSchema = z
  .object({
    semester: PublishedSemesterSchema.optional(),
    view: ViewingPerspectiveSchema.optional(),
    id: z.string().trim().min(1, "Choose a specific item to display").optional(),
  })
  .strict();

export type PublishedTimetableRequest = z.infer<typeof PublishedTimetableRequestSchema>;

/** One plain-language message: what went wrong and what to do. */
export function publishedTimetableInputMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "Invalid timetable request.";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return "The timetable request may only carry semester, view and id.";
  }
  if (issue.path[0] === "semester") return "Choose semester 1 or 2.";
  if (issue.path[0] === "view") return "Choose a group, lecturer or venue view.";
  if (issue.path[0] === "id") return "Choose a specific item to display.";
  return issue.message;
}

// ---------------------------------------------------------------------------
// Rows and choices the injected read-only store returns
// ---------------------------------------------------------------------------

/** A stored version row. A status outside TIMETABLE_VERSION_STATUSES must throw
 *  in the adapter, never be guessed; the service then reports INTERNAL_ERROR. */
export type PublishedVersionRow = {
  id: string;
  semester: number;
  status: TimetableVersionStatus;
  publishedAt: Date | null;
};

/** Missing department metadata grants no departmental access (fail closed). */
export type StudentGroupChoice = { id: string; name: string; departmentId?: string };
/** `displayName` is the linked User.name; `userId` ties a lecturer to a session. */
export type LecturerChoice = { id: string; userId: string; displayName: string };
export type VenueChoice = { id: string; code: string };

/**
 * One entry of a version with its joined display data. The entry's own scalars
 * are guaranteed by the store; every joined field is nullable so a broken
 * relationship surfaces as INVALID_PUBLISHED_DATA rather than a fabricated name.
 * Join map for M4-T4b: unitCode/unitTitle ← Teaching.unit; groupId/groupName ←
 * Teaching.group; lecturerId ← Teaching.lecturerId; lecturerName ←
 * Teaching.lecturer.user.name; venueCode ← TimetableEntry.venue.code.
 */
export type PublishedEntryRow = {
  id: string;
  versionId: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
  unitCode: string | null;
  unitTitle: string | null;
  groupId: string | null;
  groupName: string | null;
  lecturerId: string | null;
  lecturerName: string | null;
  venueCode: string | null;
};

/**
 * The atomic consistency boundary. `current` means the adapter re-confirmed, in
 * the same read transaction that returned these entries, that `version` is still
 * the unique PUBLISHED version of the semester with a non-null publishedAt.
 * `stale` means it is not, so nothing here may be presented as current.
 */
export type PublishedEntriesRead =
  | { status: "current"; version: PublishedVersionRow; entries: readonly PublishedEntryRow[] }
  | { status: "stale" };

/**
 * Injected read-only store: the minimum reads to resolve the current version,
 * the role-aware selection and one version's entries. No write method exists, so
 * no read-service path can mutate data. Scoped reads only — the adapter never
 * needs an unrestricted whole-database read.
 */
export interface PublishedTimetableStore {
  /** Every version stored PUBLISHED for that semester, in any order. */
  listPublishedVersionsBySemester(semester: number): Promise<PublishedVersionRow[]>;
  /** One read transaction: re-check currency, then read the version's entries. */
  readPublishedEntries(versionId: string, semester: number): Promise<PublishedEntriesRead>;
  listStudentGroups(): Promise<StudentGroupChoice[]>;
  listLecturers(): Promise<LecturerChoice[]>;
  findLecturerByUserId(userId: string): Promise<LecturerChoice | null>;
  listVenues(): Promise<VenueChoice[]>;
  /** Stored teaching relationships for the selected semester, never URL claims. */
  listTeachingAccess(semester: number): Promise<{ groupId: string; lecturerId: string }[]>;
}

// ---------------------------------------------------------------------------
// Displayable projection and typed result
// ---------------------------------------------------------------------------

/** Version metadata a valid current publication must carry (publishedAt non-null). */
export type PublishedVersionMeta = { id: string; semester: number; publishedAt: Date };

/** A fully resolved entry: every related field is present, real and stored. */
export type DisplayableEntry = {
  id: string;
  versionId: string;
  day: string;
  start: string;
  end: string;
  teachingId: string;
  unitCode: string;
  unitTitle: string;
  groupId: string;
  groupName: string;
  lecturerId: string;
  lecturerName: string;
  venueId: string;
  venueCode: string;
};

/**
 * Typed outcome a later page can expose safely: no exception, SQL, connection
 * string or raw error text ever reaches the client. Only `ok: true` presents a
 * timetable; `entries: []` with `ok: true` is a valid empty selection, not an
 * error. Every failure carries enough plain language for the UI to say what
 * happened and what to do.
 */
export type PublishedTimetableResult =
  | {
      ok: true;
      version: PublishedVersionMeta;
      view: ViewingPerspective;
      selectionId: string;
      semester: number;
      entries: DisplayableEntry[];
    }
  | { ok: false; kind: "UNAUTHENTICATED" }
  | { ok: false; kind: "FORBIDDEN" }
  | { ok: false; kind: "INVALID_INPUT"; message: string }
  | { ok: false; kind: "NO_PUBLISHED_VERSION"; semester: number }
  | { ok: false; kind: "AMBIGUOUS_PUBLISHED_VERSION"; semester: number }
  | { ok: false; kind: "SELECTION_REQUIRED"; message: string }
  | { ok: false; kind: "SELECTION_NOT_FOUND"; view: ViewingPerspective; selectionId: string }
  | { ok: false; kind: "IDENTITY_UNRESOLVED"; message: string }
  | { ok: false; kind: "INVALID_PUBLISHED_DATA"; message: string }
  | { ok: false; kind: "STALE"; semester: number }
  | { ok: false; kind: "INTERNAL_ERROR" };