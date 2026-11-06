/**
 * Data contract for publishing a validated DRAFT timetable version (M4-T3a):
 * the injected store interface, the atomic publication transaction, the
 * validated-snapshot token that makes it safe, and the typed result. Behaviour
 * lives in `draftPublish.ts`; what a clash-free timetable IS stays the accepted
 * `validateEntries()`'s answer, which this contract only feeds.
 *
 * Contract guarantees (each one is asserted by the service tests):
 * - Reads are separate from the single write, and a read that cannot be answered
 *   must throw so the service reports INTERNAL_ERROR instead of publishing a
 *   timetable it never really checked.
 * - `publishDraft` is ONE atomic operation. Inside it the store must re-read the
 *   target version, its entries and every validation input, recompute
 *   `publishSnapshotFingerprint` with `expected.policy`, re-read the PUBLISHED
 *   versions of that semester, and only then archive them, mark the target
 *   PUBLISHED with `publishedAt` and write the audit row — committing all of it
 *   together, or rolling all of it back and returning `{ stale: true, reason }`
 *   without claiming that anything happened.
 * - Nothing is deleted, no entry is rewritten and no version outside the
 *   target's semester changes status. An archived version keeps its rows.
 * - `publishedAt` and the audit actor come from the server. The request type has
 *   no field for a status, a publication time, a creator or an actor, and
 *   `PublishDraftInputSchema` is `.strict()`, so a forged key fails as
 *   INVALID_INPUT before a single read.
 * - The snapshot fingerprint covers exactly what the accepted validator reads
 *   (PROTOTYPE_SPEC §7): the version row, every entry, teaching and venue behind
 *   the validation, both unavailability sets and the policy values. It is an
 *   order-independent canonical encoding, not a digest, and is never persisted
 *   or logged.
 * - Limits (see DECISIONS.md M4-T3a): fields the M3 validator does not read —
 *   `Venue.status`, `Unit.scheduled`, `Unit.semester`,
 *   `Teaching.sessionsPerWeek` — cannot be protected by it, and neither can a
 *   policy value changed in code between the service's read and the commit.
 */
import { z } from "zod";
import type { PolicyConfig } from "@/domain/policy";
import type { TimetableVersionStatus } from "@/domain/types";
import type { MissingContextError, Violation } from "@/domain/validator";
import type {
  DraftEntryRow,
  LecturerUnavailableRow,
  TeachingRow,
  VenueRow,
  VenueUnavailableRow,
} from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Rows the injected store returns (database shape, not validator shape)
// ---------------------------------------------------------------------------

/**
 * The version row publication needs: the M3-T2a `DraftVersionRow` plus
 * `publishedAt`, because a DRAFT that already carries a publication time is
 * corrupt data and must not be silently re-stamped. A stored status that is not
 * one of `TIMETABLE_VERSION_STATUSES` must throw in the adapter, never be
 * guessed — the service then reports INTERNAL_ERROR and writes nothing.
 */
export type PublishVersionRow = {
  id: string;
  semester: number;
  status: TimetableVersionStatus;
  publishedAt: Date | null;
};

/**
 * Everything one validation run consumed. The service builds it from the rows it
 * read; the future adapter rebuilds it inside its transaction from the rows it
 * re-reads. Only the encoding is compared, so the payload can never carry rows
 * for the adapter to trust instead of re-reading.
 */
export type PublishSnapshot = {
  version: PublishVersionRow;
  entries: readonly DraftEntryRow[];
  teachings: readonly TeachingRow[];
  venues: readonly VenueRow[];
  lecturerUnavailable: readonly LecturerUnavailableRow[];
  venueUnavailable: readonly VenueUnavailableRow[];
  policy: PolicyConfig;
};

// ---------------------------------------------------------------------------
// Atomic publication transaction
// ---------------------------------------------------------------------------

/** Why the store refused to commit, so the service can report an honest STALE. */
export type PublishStaleReason =
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_DRAFT"
  | "SNAPSHOT_CHANGED"
  | "PUBLISHED_SET_CHANGED";

/** The preconditions the transaction must re-establish before it writes. */
export type PublishPreconditions = {
  snapshotFingerprint: string;
  /** Sorted ids of the PUBLISHED versions of this semester as the service saw them. */
  publishedVersionIds: readonly string[];
  /** The policy the validation ran under, so the recomputation is comparable. */
  policy: PolicyConfig;
};

/** Audit row written in the same transaction as the status changes. */
export type PublishAuditDraft = {
  actorId: string;
  action: "TIMETABLE_PUBLISH";
  entity: "TimetableVersion";
  reason: string;
};

export type PublishTransactionInput = {
  versionId: string;
  semester: number;
  /** Server-controlled clock value; the adapter writes it and nothing else. */
  publishedAt: Date;
  expected: PublishPreconditions;
  audit: PublishAuditDraft;
};

export type PublishTransactionOutcome =
  | { ok: true; archivedVersionIds: string[] }
  | { stale: true; reason: PublishStaleReason };

/**
 * Injected store. The seven read methods are the validation's inputs and must
 * answer from the same data the write will see; `publishDraft` is the only
 * write. No Prisma import and no database access here — the adapter is M4-T3b.
 */
export interface DraftPublishStore {
  findVersion(versionId: string): Promise<PublishVersionRow | null>;
  listEntriesByVersion(versionId: string): Promise<DraftEntryRow[]>;
  listTeachingsByIds(teachingIds: readonly string[]): Promise<TeachingRow[]>;
  listVenuesByIds(venueIds: readonly string[]): Promise<VenueRow[]>;
  listLecturerUnavailableByLecturerIds(
    lecturerIds: readonly string[],
  ): Promise<LecturerUnavailableRow[]>;
  listVenueUnavailableByVenueIds(venueIds: readonly string[]): Promise<VenueUnavailableRow[]>;
  /** Every version stored PUBLISHED for that semester, in any order. */
  listPublishedVersionsBySemester(semester: number): Promise<PublishVersionRow[]>;
  publishDraft(input: PublishTransactionInput): Promise<PublishTransactionOutcome>;
}

// ---------------------------------------------------------------------------
// Request, corrupt-data problem and typed result
// ---------------------------------------------------------------------------

/** The whole publication request: which DRAFT to publish, and nothing else. */
export type PublishDraftRequest = { versionId: string };

/** ASSUMPTION-8 gives semesters 1 and 2; a stored version outside that is corrupt. */
export const PublishSemesterSchema = z.number().int().min(1).max(2);

export const PublishDraftInputSchema = z
  .object({ versionId: z.string().trim().min(1, "Version id is required") })
  .strict();

/** One plain-language message: what went wrong and what to do. */
export function publishInputMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "Invalid input.";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return "The publication request may only carry the draft version id.";
  }
  if (issue.path[0] === "versionId") return "Choose the draft version to publish.";
  return issue.message;
}

/** Corrupt version data: real, but never publishable by guessing around it. */
export type PublishVersionProblem = "SEMESTER_OUT_OF_RANGE" | "PUBLISHED_AT_ON_DRAFT";

/**
 * Typed outcome a later server action can expose safely: no exception, SQL,
 * token or connection detail ever reaches the client. Only `ok: true` means
 * anything was published or archived; every other kind committed nothing.
 */
export type DraftPublishResult =
  | { ok: true; versionId: string; semester: number; archivedVersionIds: string[]; publishedAt: Date }
  | { ok: false; kind: "UNAUTHENTICATED" }
  | { ok: false; kind: "FORBIDDEN" }
  | { ok: false; kind: "INTERNAL_ERROR" }
  | { ok: false; kind: "INVALID_INPUT"; message: string }
  | { ok: false; kind: "VERSION_NOT_FOUND"; versionId: string }
  | { ok: false; kind: "NOT_DRAFT"; versionId: string; storedStatus: TimetableVersionStatus }
  | { ok: false; kind: "EMPTY_DRAFT"; versionId: string }
  | { ok: false; kind: "HARD_VIOLATIONS"; versionId: string; violations: Violation[] }
  | { ok: false; kind: "STALE"; reason: PublishStaleReason }
  | {
      ok: false;
      kind: "INCOMPLETE_VALIDATION";
      versionId: string;
      violations: Violation[];
      missingContext: MissingContextError[];
    }
  | {
      ok: false;
      kind: "INVALID_VERSION_DATA";
      versionId: string;
      reason: PublishVersionProblem;
      message: string;
    };

// ---------------------------------------------------------------------------
// Validated-snapshot fingerprint
// ---------------------------------------------------------------------------

function tokenOf(parts: readonly (string | number | boolean)[]): string {
  return parts.join("|");
}

/** The count is encoded too, so an empty section is never mistaken for "not read". */
function sectionOf(name: string, tokens: readonly string[]): string {
  return `${name}=${tokens.length}[${[...tokens].sort().join(";")}]`;
}

/**
 * Order-independent canonical encoding of one validation snapshot. Exported
 * because the M4-T3b adapter must produce the same string from the rows it reads
 * inside its transaction; comparing the two is how a draft that changed — or an
 * academic or venue input that changed underneath a byte-identical draft — is
 * caught before anything is committed.
 */
export function publishSnapshotFingerprint(snapshot: PublishSnapshot): string {
  const { version, policy } = snapshot;
  const time = version.publishedAt === null ? "" : String(version.publishedAt.getTime());
  return [
    `version=${tokenOf([version.id, version.semester, version.status, time])}`,
    sectionOf("entries", snapshot.entries.map((row) => tokenOf([
      row.id, row.versionId, row.teachingId, row.venueId, row.day, row.start, row.end, row.locked,
    ]))),
    sectionOf("teachings", snapshot.teachings.map((row) => tokenOf([
      row.id, row.lecturerId, row.groupId, row.expectedSize, row.unitCode, row.venueTypeRequired,
    ]))),
    sectionOf("venues", snapshot.venues.map((row) => tokenOf([row.id, row.code, row.capacity, row.type]))),
    sectionOf("lecturerUnavailable", snapshot.lecturerUnavailable.map((row) => tokenOf([
      row.id, row.lecturerId, row.day, row.start, row.end, row.available,
    ]))),
    sectionOf("venueUnavailable", snapshot.venueUnavailable.map((row) => tokenOf([
      row.id, row.venueId, row.day, row.start, row.end, row.reason ?? "",
    ]))),
    `policy=${tokenOf([
      policy.days.join(","), policy.slotStart, policy.slotEnd, policy.lunchStart, policy.lunchEnd,
      policy.maxHoursPerLecturerPerDay, policy.maxClassesPerGroupPerDay,
    ])}`,
  ].join(" ");
}
