/**
 * Server-side, read-only loader for one DRAFT timetable version (M3-T2a).
 *
 * Assembles the `ValidationContext` that `validateEntries()` needs from
 * database-shaped rows and returns the draft entries plus the
 * `ValidationOutcome`, ready for the officer draft editor (M3-T2b) to consume.
 * Performs no writes and renders no UI.
 *
 * Security rules enforced here, not in the UI:
 * - EDIT_DRAFT is decided BEFORE any store call, so an unauthorised caller
 *   (student, lecturer, department rep, approver, admin) triggers zero reads
 *   of timetable data and learns nothing about whether a version exists.
 * - Only a version whose stored status is DRAFT is editable; PUBLISHED and
 *   ARCHIVED are refused without loading their entries.
 * - Entries are re-filtered to the requested version id even though the store
 *   query is already scoped by it, so a broken WHERE clause cannot leak rows
 *   belonging to another version.
 * - A store failure is reported as INTERNAL_ERROR. It is never degraded into
 *   an empty teaching, venue or unavailable-period list, which would let the
 *   validator report a clean draft for data it could not read.
 *
 * The store is injected so this logic is unit-testable without a database;
 * the Prisma implementation lives in src/server/draftStorePrisma.ts.
 */
import { decideAccess } from "@/domain/access";
import {
  unavailablePeriodsFromRecords,
  type AvailabilityRecord,
  type StoredUnavailablePeriod,
} from "@/domain/lecturerAvailability";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy";
import type { Actor } from "@/domain/permissions";
import type { TimetableVersionStatus } from "@/domain/types";
import {
  validateEntries,
  type EntryInput,
  type TeachingInfo,
  type ValidationContext,
  type ValidationOutcome,
  type VenueInfo,
  type VenueUnavailablePeriod,
} from "@/domain/validator";

// ---------------------------------------------------------------------------
// Rows the injected store returns (database shape, not validator shape)
// ---------------------------------------------------------------------------

export type DraftVersionRow = {
  id: string;
  semester: number;
  status: TimetableVersionStatus;
};

export type DraftEntryRow = {
  id: string;
  versionId: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
  locked: boolean;
};

/** A Teaching row joined with the Unit fields the validator needs. */
export type TeachingRow = {
  id: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  unitCode: string;
  venueTypeRequired: string;
};

export type VenueRow = {
  id: string;
  code: string;
  capacity: number;
  type: string;
};

/** A LecturerAvailability row plus its lecturer, day/time still untrusted strings. */
export type LecturerUnavailableRow = AvailabilityRecord & { lecturerId: string };

export type VenueUnavailableRow = {
  id: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
  reason: string | null;
};

export interface DraftValidationStore {
  findVersion(versionId: string): Promise<DraftVersionRow | null>;
  listEntriesByVersion(versionId: string): Promise<DraftEntryRow[]>;
  listTeachingsByIds(teachingIds: readonly string[]): Promise<TeachingRow[]>;
  listVenuesByIds(venueIds: readonly string[]): Promise<VenueRow[]>;
  listLecturerUnavailableByLecturerIds(
    lecturerIds: readonly string[],
  ): Promise<LecturerUnavailableRow[]>;
  listVenueUnavailableByVenueIds(
    venueIds: readonly string[],
  ): Promise<VenueUnavailableRow[]>;
}

// ---------------------------------------------------------------------------
// Result shape returned to the server layer
// ---------------------------------------------------------------------------

export type DraftVersionInfo = {
  id: string;
  semester: number;
  /** Always "DRAFT": any other stored status is refused by the loader. */
  status: TimetableVersionStatus;
};

/**
 * One draft entry plus the codes the officer interface needs to label the row.
 * Both are null when the context could not resolve the reference — the
 * validator reports that as a MISSING_TEACHING / MISSING_VENUE data-integrity
 * error, so the row still appears in the editor instead of silently vanishing.
 */
export type DraftEntryView = EntryInput & {
  locked: boolean;
  unitCode: string | null;
  venueCode: string | null;
};

export type DraftLoadResult =
  | {
      ok: true;
      version: DraftVersionInfo;
      entries: DraftEntryView[];
      validation: ValidationOutcome;
    }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR" }
  | {
      ok: false;
      kind: "NOT_DRAFT";
      versionId: string;
      storedStatus: TimetableVersionStatus;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** An id list with no entries must not cost a database round trip. */
function queryByIds<T>(
  ids: readonly string[],
  query: (ids: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  return ids.length === 0 ? Promise.resolve([]) : query(ids);
}

/**
 * Lookups are built with Object.fromEntries so a key such as "__proto__"
 * becomes an own property instead of touching the prototype. This read applies
 * the same own-key guard the validator uses, so an odd id never resolves
 * through the prototype chain.
 */
function own<T>(lookup: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(lookup, key) ? lookup[key] : undefined;
}

function lecturerPeriodsByLecturer(
  rows: readonly LecturerUnavailableRow[],
): Record<string, StoredUnavailablePeriod[]> {
  const grouped = new Map<string, AvailabilityRecord[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.lecturerId);
    if (bucket === undefined) {
      grouped.set(row.lecturerId, [row]);
    } else {
      bucket.push(row);
    }
  }
  return Object.fromEntries(
    [...grouped].map(([lecturerId, records]) => [
      lecturerId,
      unavailablePeriodsFromRecords(records),
    ]),
  );
}

/**
 * Venue periods are passed through as stored. The validator compares the day
 * for equality and requires a well-formed, positively-sized range to overlap,
 * so a corrupt row restricts nothing rather than blocking every class.
 */
function venuePeriodsByVenue(
  rows: readonly VenueUnavailableRow[],
): Record<string, VenueUnavailablePeriod[]> {
  const grouped = new Map<string, VenueUnavailablePeriod[]>();
  for (const row of rows) {
    const period: VenueUnavailablePeriod = {
      day: row.day,
      start: row.start,
      end: row.end,
    };
    if (row.reason !== null) {
      period.reason = row.reason;
    }
    const bucket = grouped.get(row.venueId);
    if (bucket === undefined) {
      grouped.set(row.venueId, [period]);
    } else {
      bucket.push(period);
    }
  }
  return Object.fromEntries(grouped);
}

function toEntryInput(row: DraftEntryRow): EntryInput {
  return {
    id: row.id,
    teachingId: row.teachingId,
    venueId: row.venueId,
    day: row.day,
    start: row.start,
    end: row.end,
  };
}

/**
 * The editor highlights rows by position and `ValidationOutcome.entryIndex`
 * refers to that position, so entries are placed in week order — policy day
 * sequence, then start time, then id — whatever order the database returned.
 * A day the policy does not list sorts last; the validator still reports such
 * an entry as OUT_OF_SLOT.
 */
function sortEntries(
  rows: readonly DraftEntryRow[],
  policy: PolicyConfig,
): DraftEntryRow[] {
  const dayRank = new Map(policy.days.map((day, index) => [day, index]));
  const unlistedDay = policy.days.length;
  return [...rows].sort((a, b) => {
    const rankA = dayRank.get(a.day) ?? unlistedDay;
    const rankB = dayRank.get(b.day) ?? unlistedDay;
    if (rankA !== rankB) return rankA - rankB;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}

function toEntryViews(
  entries: readonly DraftEntryRow[],
  teachings: Record<string, TeachingInfo>,
  venues: Record<string, VenueInfo>,
): DraftEntryView[] {
  return entries.map((row) => ({
    ...toEntryInput(row),
    locked: row.locked,
    unitCode: own(teachings, row.teachingId)?.unitCode ?? null,
    venueCode: own(venues, row.venueId)?.code ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load one DRAFT version, validate its entries with the existing pure
 * validator, and return both. `policy` defaults to `DEFAULT_POLICY`; a caller
 * may pass another policy without the validator being touched.
 *
 * The empty-draft case is a real answer, not a failure: an entry list with no
 * rows validates to `{ status: "ok", violations: [] }`. A draft whose entries
 * reference missing teachings or venues keeps `status: "incomplete"` with its
 * `missingContext` errors, and an empty violations list alone is never success.
 */
export async function loadDraftForValidation(
  store: DraftValidationStore,
  actor: Actor | null,
  versionId: string,
  policy: PolicyConfig = DEFAULT_POLICY,
): Promise<DraftLoadResult> {
  const access = decideAccess(actor, "EDIT_DRAFT");
  if (access.status !== "ALLOW") {
    return access.status === "UNAUTHENTICATED"
      ? { ok: false, kind: "UNAUTHENTICATED" }
      : { ok: false, kind: "FORBIDDEN" };
  }

  try {
    const version = await store.findVersion(versionId);
    if (version === null) {
      return { ok: false, kind: "NOT_FOUND" };
    }
    if (version.status !== "DRAFT") {
      return {
        ok: false,
        kind: "NOT_DRAFT",
        versionId: version.id,
        storedStatus: version.status,
      };
    }

    const rows = await store.listEntriesByVersion(versionId);
    const entries = sortEntries(
      rows.filter((row) => row.versionId === versionId),
      policy,
    );

    const teachingRows = await queryByIds(
      uniqueIds(entries.map((row) => row.teachingId)),
      (ids) => store.listTeachingsByIds(ids),
    );
    const venueIds = uniqueIds(entries.map((row) => row.venueId));
    const venueRows = await queryByIds(venueIds, (ids) => store.listVenuesByIds(ids));

    const teachings: Record<string, TeachingInfo> = Object.fromEntries(
      teachingRows.map((row) => [
        row.id,
        {
          lecturerId: row.lecturerId,
          groupId: row.groupId,
          expectedSize: row.expectedSize,
          venueTypeRequired: row.venueTypeRequired,
          unitCode: row.unitCode,
        },
      ]),
    );

    const venues: Record<string, VenueInfo> = Object.fromEntries(
      venueRows.map((row) => [
        row.id,
        { capacity: row.capacity, type: row.type, code: row.code },
      ]),
    );

    const lecturerUnavailable = await queryByIds(
      uniqueIds(Object.values(teachings).map((teaching) => teaching.lecturerId)),
      (ids) => store.listLecturerUnavailableByLecturerIds(ids),
    );
    const venueUnavailable = await queryByIds(venueIds, (ids) =>
      store.listVenueUnavailableByVenueIds(ids),
    );

    const context: ValidationContext = {
      teachings,
      venues,
      lecturerUnavailable: lecturerPeriodsByLecturer(lecturerUnavailable),
      venueUnavailable: venuePeriodsByVenue(venueUnavailable),
    };

    return {
      ok: true,
      version: {
        id: version.id,
        semester: version.semester,
        status: version.status,
      },
      entries: toEntryViews(entries, teachings, venues),
      validation: validateEntries(
        entries.map(toEntryInput),
        context,
        policy,
      ),
    };
  } catch (error) {
    console.error(
      "[draftValidation] load failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
