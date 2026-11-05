/**
 * Data contract for generating a new DRAFT timetable version (M4-T2a): the
 * injected store interface, the atomic-persistence payload, the typed result and
 * the request validation. Behaviour lives in `draftGenerate.ts`; the rules about
 * what a feasible, clash-free timetable IS stay in the accepted
 * `generateTimetable()` and `validateEntries()`, which this contract only feeds.
 *
 * Contract guarantees (each one is asserted by the service tests):
 * - Reads are separate from the single write, and a read that cannot be answered
 *   must throw so the service reports INTERNAL_ERROR instead of generating from
 *   an accidentally empty dataset.
 * - `listTeachingsForSemester` is scoped by semester and carries
 *   `semesterExists`, so a genuinely empty semester stays distinguishable from
 *   unreadable or out-of-scope data.
 * - `listLockedEntriesByVersion` feeds only the source draft's locked rows into
 *   the generator's `fixedEntries`; unlocked draft rows are proposals, not
 *   commitments, and are never treated as fixed sessions.
 * - `persistGeneratedDraft` is one atomic operation creating a NEW version with
 *   `status: "DRAFT"`, its entries and the audit row, or nothing at all. It
 *   re-verifies `expectedSource` first, so a source draft that was published or
 *   whose locked rows changed while the input was loading fails as `{ stale:
 *   true }`. Generated versions are always separate records: the source draft is
 *   never edited in place, and the store assigns new entry ids while
 *   `sourceEntryId` keeps the source-to-copy mapping.
 */
import { z } from "zod";
import type {
  GeneratorPeriod,
  GeneratorTeaching,
  GeneratorVenue,
  UnplacedActivity,
  UnplacedFixed,
} from "@/domain/generator";
import type { TimetableVersionStatus } from "@/domain/types";
import type {
  MissingContextError,
  TeachingInfo,
  VenueInfo,
  VenueUnavailablePeriod,
  Violation,
} from "@/domain/validator";
import type {
  DraftEntryRow,
  DraftVersionRow,
  LecturerUnavailableRow,
  VenueRow,
  VenueUnavailableRow,
} from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Rows the injected store returns. Several shapes are reused from the M3-T2a
// read loader so they cannot drift apart.
// ---------------------------------------------------------------------------

/** A Teaching joined with the Unit fields the generator needs. */
export type GenerationTeachingRow = GeneratorTeaching & {
  /** Unit semester — re-checked against the requested scope. */
  semester: number;
  /** Unit.scheduled — a false row is never timetabled (ASSUMPTION-16). */
  scheduled: boolean;
};

/**
 * `semesterExists` is false only when the store has no Unit row for that
 * semester; an empty `teachings` list with `semesterExists: true` is a
 * genuinely empty, valid semester. A read that cannot be answered must throw.
 */
export type SemesterTeachingRead = {
  semesterExists: boolean;
  teachings: GenerationTeachingRow[];
};

/**
 * Concurrency token for the source draft. `lockedFingerprint` is derived from
 * exactly the locked rows that were loaded (id, teaching, venue, day, start,
 * end — order-independent), so the write can prove the source did not change.
 */
export type GenerateSourceToken = {
  versionId: string;
  versionStatus: TimetableVersionStatus;
  lockedFingerprint: string;
};

/**
 * One row of the new version. `sourceEntryId` maps a copied locked row back to
 * the draft it came from; generated rows have null. The store assigns the new
 * persistent ids — an entry id never belongs to two versions.
 */
export type GeneratedDraftEntry = {
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
  locked: boolean;
  sourceEntryId: string | null;
};

/** Everything needed to create the new DRAFT version in one transaction. */
export type GeneratedDraftPayload = {
  semester: number;
  /** Always "DRAFT": this operation never publishes or archives. */
  status: "DRAFT";
  /** Authenticated actor id, from the session — never from input. */
  createdBy: string;
  sourceVersionId: string | null;
  expectedSource: GenerateSourceToken | null;
  softScore: number;
  entries: GeneratedDraftEntry[];
};

/** Audit row written in the same transaction as the version and its entries. */
export type GenerateAuditDraft = {
  actorId: string;
  action: "TIMETABLE_DRAFT_GENERATE";
  entity: "TimetableVersion";
  reason: string;
};

/**
 * Injected store. The first six methods are reads; `persistGeneratedDraft` is
 * the only write and must be atomic: re-verify the source token and that the
 * version is still DRAFT, then create the version, its entries (fresh ids, lock
 * flags and source mapping preserved) and the audit row together — or nothing
 * at all. The Prisma adapter is M4-T2b; nothing here touches a database.
 */
export interface DraftGenerateStore {
  findVersion(versionId: string): Promise<DraftVersionRow | null>;
  listLockedEntriesByVersion(versionId: string): Promise<DraftEntryRow[]>;
  listTeachingsForSemester(semester: number): Promise<SemesterTeachingRead>;
  /** Eligible venues only: `status: "ACTIVE"`, with capacity and type. */
  listActiveVenues(): Promise<VenueRow[]>;
  listLecturerUnavailableByLecturerIds(
    lecturerIds: readonly string[],
  ): Promise<LecturerUnavailableRow[]>;
  listVenueUnavailableByVenueIds(venueIds: readonly string[]): Promise<VenueUnavailableRow[]>;
  persistGeneratedDraft(
    payload: GeneratedDraftPayload,
    audit: GenerateAuditDraft,
  ): Promise<{ ok: true; versionId: string } | { stale: true }>;
}

// ---------------------------------------------------------------------------
// Request, problems and typed result
// ---------------------------------------------------------------------------

export type GenerateDraftRequest = {
  semester: number;
  /** Existing DRAFT whose locked rows must be kept; null for a fresh draft. */
  sourceVersionId?: string | null;
};

export type GenerationProblemKind =
  | "SEMESTER_NOT_FOUND"
  | "NO_SCHEDULED_TEACHINGS"
  | "NO_ACTIVE_VENUES"
  | "DATASET_SCOPE_MISMATCH"
  | "SOURCE_SEMESTER_MISMATCH"
  | "SOURCE_ENTRY_UNRESOLVED";

/** One reason the generator input could not be assembled completely. */
export type GenerationProblem = {
  kind: GenerationProblemKind;
  message: string;
  entryId?: string;
  sourceVersionId?: string;
};

/**
 * Typed outcome a later server action can expose safely: no exception and no
 * database detail ever reaches the client. Only `ok: true` means a version was
 * created; every other kind writes nothing.
 */
export type DraftGenerateResult =
  | { ok: true; versionId: string; entryCount: number; softScore: number }
  | { ok: false; kind: "UNAUTHENTICATED" }
  | { ok: false; kind: "FORBIDDEN" }
  | { ok: false; kind: "INTERNAL_ERROR" }
  | { ok: false; kind: "STALE"; sourceVersionId: string | null }
  | { ok: false; kind: "INVALID_INPUT"; message: string }
  | { ok: false; kind: "SOURCE_NOT_FOUND"; sourceVersionId: string }
  | {
      ok: false;
      kind: "SOURCE_NOT_DRAFT";
      sourceVersionId: string;
      storedStatus: TimetableVersionStatus;
    }
  | { ok: false; kind: "INCOMPLETE_INPUT"; problems: GenerationProblem[] }
  | {
      ok: false;
      kind: "PARTIAL_GENERATION";
      unplaced: (UnplacedActivity | UnplacedFixed)[];
      placedCount: number;
      softScore: number;
    }
  | {
      ok: false;
      kind: "INVALID_GENERATION";
      violations: Violation[];
      missingContext: MissingContextError[];
    };

/** Semester scope is explicit; ASSUMPTION-8 gives semesters 1 and 2. */
export const GenerateDraftInputSchema = z.object({
  semester: z
    .number()
    .int("Semester must be a whole number")
    .min(1, "Semester must be 1 or 2")
    .max(2, "Semester must be 1 or 2"),
  sourceVersionId: z
    .union([z.string().trim().min(1, "Source version id is required"), z.null()])
    .optional(),
});

/** One plain-language message: what went wrong and what to do about it. */
export function generateInputMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "Invalid input.";
  if (issue.path[0] === "semester") return "Semester must be 1 or 2.";
  return issue.message;
}

// ---------------------------------------------------------------------------
// Mapping between store rows and the accepted domain shapes
// ---------------------------------------------------------------------------

export function toGeneratorPeriods(
  rows: readonly { day: string; start: string; end: string }[],
): GeneratorPeriod[] {
  return rows.map((row) => ({ day: row.day, start: row.start, end: row.end }));
}

export function toTeachingInfo(row: GenerationTeachingRow): TeachingInfo {
  return {
    lecturerId: row.lecturerId,
    groupId: row.groupId,
    expectedSize: row.expectedSize,
    venueTypeRequired: row.venueTypeRequired,
    unitCode: row.unitCode,
  };
}

export function toGeneratorVenue(venue: VenueRow): GeneratorVenue {
  return { id: venue.id, code: venue.code, type: venue.type, capacity: venue.capacity };
}

export function toValidatorVenue(venue: VenueRow): VenueInfo {
  return { capacity: venue.capacity, type: venue.type, code: venue.code };
}

export function toVenueUnavailablePeriods(
  rows: readonly VenueUnavailableRow[],
): VenueUnavailablePeriod[] {
  return rows.map((row) => ({
    day: row.day,
    start: row.start,
    end: row.end,
    ...(row.reason === null ? {} : { reason: row.reason }),
  }));
}

/**
 * Order-independent, so the same locked rows always produce the same token.
 * Exported because the M4-T2b adapter must recompute it inside its transaction
 * to prove the source draft did not change.
 */
export function lockedFingerprint(rows: readonly DraftEntryRow[]): string {
  return rows
    .map((row) => `${row.id}|${row.teachingId}|${row.venueId}|${row.day}|${row.start}|${row.end}`)
    .sort()
    .join(";");
}

// ---------------------------------------------------------------------------
// Store-access helpers
// ---------------------------------------------------------------------------

/** An empty id list must not cost a database round trip. */
export function queryByIds<T>(
  ids: readonly string[],
  query: (ids: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  return ids.length === 0 ? Promise.resolve([]) : query(ids);
}

/** Grouping by a row key keeps one read per resource type instead of per row. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket === undefined) grouped.set(key(row), [row]);
    else bucket.push(row);
  }
  return grouped;
}
