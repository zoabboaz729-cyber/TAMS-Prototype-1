/**
 * Prisma adapter for the accepted M4-T3a `DraftPublishStore` contract (M4-T3b).
 * It implements the seven scoped reads the publication service uses and the one
 * atomic transaction that archives the PUBLISHED versions of the target's own
 * semester, marks the target PUBLISHED with the server's clock and writes the
 * publication audit row — or commits nothing at all.
 *
 * Read rules (each one is asserted against a real SQLite file):
 * - The same query builders serve the service's reads and the transaction's
 *   re-reads, so the snapshot the officer was shown and the snapshot the commit
 *   recomputes are built with literally identical WHERE, ORDER BY and SELECT.
 *   Nothing here re-implements the scoping with different filters: an
 *   availability filter that differed between the two paths would change the
 *   fingerprint for reasons no one could explain.
 * - `listVenuesByIds` is scoped by id only. A venue whose `status` became
 *   MAINTENANCE or INACTIVE is still the venue the entries reference, so it must
 *   reach the validator and the snapshot rather than vanish into a
 *   `MISSING_VENUE` that hides what actually happened (M3-T2a does the same).
 * - Lecturer blocking periods follow the accepted M3 loader's semantics:
 *   `available: false` only, because `available: true` restricts nothing
 *   (`unavailablePeriodsFromRecords()` drops it). The `available` field is still
 *   selected and fingerprinted, so a row that flips from true to false is a
 *   changed snapshot even though the validator's answer for a clean draft is the
 *   same.
 * - `VenueUnavailable.reason` is read as the `string | null` it is stored as.
 *   Coercing it to `""` would fold "no reason recorded" into "an empty reason
 *   was recorded" and every publication would then look stale or look clean for
 *   the wrong reason (DECISIONS.md M4-T3a1, consequence for M4-T3b).
 * - A stored status outside `TIMETABLE_VERSION_STATUSES` throws — it is parsed,
 *   never guessed — so corrupt data surfaces as INTERNAL_ERROR instead of
 *   pretending to be a stale request or a DRAFT.
 * - Every read goes straight to Prisma. A failed query throws and the service
 *   converts it to INTERNAL_ERROR; nothing here substitutes an empty array for
 *   data that could not be read.
 *
 * `publishDraft` rules (one interactive `$transaction`, in this order):
 * 1. Re-read the target from the transaction client: missing →
 *    `VERSION_NOT_FOUND`; corrupt status → throw; no longer DRAFT →
 *    `VERSION_NOT_DRAFT`; a semester that is not `input.semester` →
 *    `SNAPSHOT_CHANGED`, because archiving a different semester's versions than
 *    the one the officer was shown is the one outcome that must never happen.
 * 2. Re-read the target's entries, the teachings and venues behind them and both
 *    unavailability sets, rebuild the accepted `PublishSnapshot` from those rows
 *    and compare `publishSnapshotFingerprint(snapshot)` with
 *    `input.expected.snapshotFingerprint`. The fingerprint is never taken from
 *    the request, the service's rows or a cache — it is recomputed here.
 * 3. Re-read the PUBLISHED versions of `input.semester` and compare their sorted
 *    ids with `input.expected.publishedVersionIds`; a difference is
 *    `PUBLISHED_SET_CHANGED`. Rows outside that scope (a broken WHERE, or the
 *    target itself already listed as PUBLISHED) throw instead of widening the
 *    archive target.
 * 4. Only then write: archive with a conditional `updateMany` that still
 *    requires `status: "PUBLISHED"` and the same semester (status only —
 *    `publishedAt` and every timetable entry of an archived version are
 *    preserved), then stamp the target with a conditional `updateMany` that
 *    still requires `status: "DRAFT"`, the same semester and a null
 *    `publishedAt`, then write the audit row. A conditional update that matches
 *    fewer rows than expected is a failed precondition and throws, so nothing
 *    partially committed is ever reported as a publication; every throw rolls
 *    the whole transaction back.
 *
 * What this actually guarantees, stated precisely (DECISIONS.md M4-T3b): SQLite
 * allows one writer per database file, so publication transactions serialise
 * rather than interleave, and the second one recomputes a token that no longer
 * matches. The fingerprint plus the conditional updates therefore refuse a write
 * that another committed write has already invalidated. They are an optimistic
 * check, not a lock and not a database constraint: `TimetableVersion` has plain
 * indexes on `semester` and `status`, no unique constraint on one PUBLISHED
 * version per semester, and creating a migration was out of scope for this task.
 * A lock or transaction failure throws — it is never reported as success. Fields
 * the M3 validator does not read (`Venue.status`, `Unit.scheduled`,
 * `Unit.semester`, `Teaching.sessionsPerWeek`) stay outside the token's scope.
 *
 * `client` is injected so tests can target an isolated SQLite file; production
 * uses the existing singleton. No migration, no schema change, no new table, no
 * server action and no UI — those are M4-T3c.
 */
import { TimetableVersionStatusSchema } from "@/domain/types";
import type { PolicyConfig } from "@/domain/policy";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type {
  DraftEntryRow,
  LecturerUnavailableRow,
  TeachingRow,
  VenueRow,
  VenueUnavailableRow,
} from "@/server/draftValidation";
import {
  publishSnapshotFingerprint,
  type DraftPublishStore,
  type PublishSnapshot,
  type PublishTransactionInput,
  type PublishTransactionOutcome,
  type PublishVersionRow,
} from "@/server/draftPublishContract";

// ---------------------------------------------------------------------------
// Selects, ordering and scoped queries
// ---------------------------------------------------------------------------

const versionSelect = { id: true, semester: true, status: true, publishedAt: true } as const;

const entrySelect = {
  id: true,
  versionId: true,
  teachingId: true,
  venueId: true,
  day: true,
  start: true,
  end: true,
  locked: true,
} as const;

const teachingSelect = {
  id: true,
  lecturerId: true,
  groupId: true,
  expectedSize: true,
  unit: { select: { code: true, venueTypeRequired: true } },
} as const;

const venueSelect = { id: true, code: true, capacity: true, type: true } as const;

const lecturerUnavailableSelect = {
  id: true,
  lecturerId: true,
  day: true,
  start: true,
  end: true,
  available: true,
} as const;

const venueUnavailableSelect = {
  id: true,
  venueId: true,
  day: true,
  start: true,
  end: true,
  reason: true,
} as const;

/** Every `id` tie-break keeps a repeated read byte-identical even for rows that
 *  share a day and a start time, which the fingerprint sorts anyway. The query
 *  builders below stay un-annotated so Prisma infers each row's exact shape
 *  (including the joined `unit`) instead of the whole model. */
const versionOrder: Prisma.TimetableVersionOrderByWithRelationInput = { id: "asc" };
const teachingOrder: Prisma.TeachingOrderByWithRelationInput = { id: "asc" };
const venueOrder: Prisma.VenueOrderByWithRelationInput = { id: "asc" };
const entryOrder: Prisma.TimetableEntryOrderByWithRelationInput[] = [{ day: "asc" }, { start: "asc" }, { id: "asc" }];
const lecturerUnavailableOrder: Prisma.LecturerAvailabilityOrderByWithRelationInput[] = [
  { lecturerId: "asc" }, { day: "asc" }, { start: "asc" }, { id: "asc" },
];
const venueUnavailableOrder: Prisma.VenueUnavailableOrderByWithRelationInput[] = [
  { venueId: "asc" }, { day: "asc" }, { start: "asc" }, { id: "asc" },
];

const entriesOfVersionQuery = (versionId: string) => ({
  where: { versionId },
  orderBy: entryOrder,
  select: entrySelect,
});

const teachingsByIdsQuery = (ids: readonly string[]) => ({
  where: { id: { in: [...ids] } },
  orderBy: teachingOrder,
  select: teachingSelect,
});

/** Id-scoped only: a venue's status is not this adapter's filter to apply. */
const venuesByIdsQuery = (ids: readonly string[]) => ({
  where: { id: { in: [...ids] } },
  orderBy: venueOrder,
  select: venueSelect,
});

/** `available: false` only, matching the accepted M3 loader exactly. */
const lecturerUnavailableQuery = (ids: readonly string[]) => ({
  where: { lecturerId: { in: [...ids] }, available: false },
  orderBy: lecturerUnavailableOrder,
  select: lecturerUnavailableSelect,
});

const venueUnavailableQuery = (ids: readonly string[]) => ({
  where: { venueId: { in: [...ids] } },
  orderBy: venueUnavailableOrder,
  select: venueUnavailableSelect,
});

const publishedVersionsQuery = (semester: number) => ({
  where: { semester, status: "PUBLISHED" },
  orderBy: versionOrder,
  select: versionSelect,
});

// ---------------------------------------------------------------------------
// Row converters and helpers
// ---------------------------------------------------------------------------

type TeachingDbRow = {
  id: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  unit: { code: string; venueTypeRequired: string };
};

type VersionDbRow = { id: string; semester: number; status: string; publishedAt: Date | null };

/** A client or the transaction client bound to the same database. */
type ReadClient = PrismaClient | Prisma.TransactionClient;

/** A stored status outside the declared values throws; nothing is guessed. */
function toVersionRow(row: VersionDbRow): PublishVersionRow {
  return {
    id: row.id,
    semester: row.semester,
    status: TimetableVersionStatusSchema.parse(row.status),
    publishedAt: row.publishedAt,
  };
}

function toTeachingRow(row: TeachingDbRow): TeachingRow {
  return {
    id: row.id,
    lecturerId: row.lecturerId,
    groupId: row.groupId,
    expectedSize: row.expectedSize,
    unitCode: row.unit.code,
    venueTypeRequired: row.unit.venueTypeRequired,
  };
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sortedIds(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedIds(left);
  const b = sortedIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** An id list with no entries must not cost a database round trip. */
async function queryByIds<T>(ids: readonly string[], query: (ids: readonly string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? [] : query(ids);
}

/**
 * The snapshot the M3-T3a service validated, rebuilt from the rows one client
 * can read right now. Used by the transaction with its own `tx`, which is what
 * makes the comparison a re-read and not a restatement of the request.
 */
async function readSnapshot(client: ReadClient, version: PublishVersionRow, policy: PolicyConfig): Promise<PublishSnapshot> {
  const entryRows = await client.timetableEntry.findMany(entriesOfVersionQuery(version.id));
  const entries = entryRows.filter((row) => row.versionId === version.id);
  const venueIds = uniqueIds(entries.map((row) => row.venueId));
  const teachings = await queryByIds(uniqueIds(entries.map((row) => row.teachingId)), async (ids) =>
    (await client.teaching.findMany(teachingsByIdsQuery(ids))).map(toTeachingRow),
  );
  const venues = await queryByIds(venueIds, (ids) => client.venue.findMany(venuesByIdsQuery(ids)));
  const lecturerUnavailable = await queryByIds(uniqueIds(teachings.map((row) => row.lecturerId)), (ids) =>
    client.lecturerAvailability.findMany(lecturerUnavailableQuery(ids)),
  );
  const venueUnavailable = await queryByIds(venueIds, (ids) => client.venueUnavailable.findMany(venueUnavailableQuery(ids)));
  return { version, entries, teachings, venues, lecturerUnavailable, venueUnavailable, policy };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Prisma implementation of `DraftPublishStore`. The default client is the shared
 * singleton; tests inject a client bound to an isolated database file.
 */
export function createDraftPublishStore(client: PrismaClient = prisma): DraftPublishStore {
  return {
    async findVersion(versionId): Promise<PublishVersionRow | null> {
      const row = await client.timetableVersion.findUnique({ where: { id: versionId }, select: versionSelect });
      return row === null ? null : toVersionRow(row);
    },

    async listEntriesByVersion(versionId): Promise<DraftEntryRow[]> {
      return client.timetableEntry.findMany(entriesOfVersionQuery(versionId));
    },

    async listTeachingsByIds(teachingIds): Promise<TeachingRow[]> {
      const rows = await client.teaching.findMany(teachingsByIdsQuery(teachingIds));
      return rows.map(toTeachingRow);
    },

    async listVenuesByIds(venueIds): Promise<VenueRow[]> {
      return client.venue.findMany(venuesByIdsQuery(venueIds));
    },

    async listLecturerUnavailableByLecturerIds(lecturerIds): Promise<LecturerUnavailableRow[]> {
      return client.lecturerAvailability.findMany(lecturerUnavailableQuery(lecturerIds));
    },

    async listVenueUnavailableByVenueIds(venueIds): Promise<VenueUnavailableRow[]> {
      return client.venueUnavailable.findMany(venueUnavailableQuery(venueIds));
    },

    async listPublishedVersionsBySemester(semester): Promise<PublishVersionRow[]> {
      const rows = await client.timetableVersion.findMany(publishedVersionsQuery(semester));
      return rows.map(toVersionRow);
    },

    /**
     * The whole publication: re-read, recompute, recheck, then archive + publish
     * + audit — in one transaction that either commits all three or none.
     */
    async publishDraft(input: PublishTransactionInput): Promise<PublishTransactionOutcome> {
      return client.$transaction(async (tx) => {
        const target = await tx.timetableVersion.findUnique({ where: { id: input.versionId }, select: versionSelect });
        if (target === null) return { stale: true, reason: "VERSION_NOT_FOUND" } as const;
        const parsed = TimetableVersionStatusSchema.safeParse(target.status);
        if (!parsed.success) {
          throw new Error(`Version ${target.id} has a corrupt status; refusing to guess.`);
        }
        if (parsed.data !== "DRAFT") return { stale: true, reason: "VERSION_NOT_DRAFT" } as const;
        if (target.semester !== input.semester) {
          // The token names the semester that was validated; archiving another
          // one is the failure this check exists to make impossible.
          return { stale: true, reason: "SNAPSHOT_CHANGED" } as const;
        }
        const version: PublishVersionRow = toVersionRow({ ...target, status: parsed.data });

        const snapshot = await readSnapshot(tx, version, input.expected.policy);
        if (publishSnapshotFingerprint(snapshot) !== input.expected.snapshotFingerprint) {
          return { stale: true, reason: "SNAPSHOT_CHANGED" } as const;
        }

        const publishedRows = await tx.timetableVersion.findMany(publishedVersionsQuery(input.semester));
        const published = publishedRows.map(toVersionRow).filter((row) => row.id !== version.id);
        if (published.length !== publishedRows.length) {
          throw new Error(`published-version read for semester ${input.semester} included the target version; refusing to archive it.`);
        }
        const archivedVersionIds = sortedIds(published.map((row) => row.id));
        if (!sameIdSet(archivedVersionIds, input.expected.publishedVersionIds)) {
          return { stale: true, reason: "PUBLISHED_SET_CHANGED" } as const;
        }

        if (archivedVersionIds.length > 0) {
          const archived = await tx.timetableVersion.updateMany({
            where: { id: { in: archivedVersionIds }, status: "PUBLISHED", semester: input.semester },
            data: { status: "ARCHIVED" },
          });
          if (archived.count !== archivedVersionIds.length) {
            throw new Error(
              `archiving semester ${input.semester} matched ${archived.count} of ${archivedVersionIds.length} published versions; rolling back.`,
            );
          }
        }

        const stamped = await tx.timetableVersion.updateMany({
          where: { id: version.id, status: "DRAFT", semester: input.semester, publishedAt: null },
          data: { status: "PUBLISHED", publishedAt: input.publishedAt },
        });
        if (stamped.count !== 1) {
          throw new Error(`publication of ${version.id} matched ${stamped.count} rows; rolling back.`);
        }

        await tx.auditLog.create({
          data: {
            actorId: input.audit.actorId,
            action: input.audit.action,
            entity: input.audit.entity,
            entityId: version.id,
            reason: input.audit.reason,
          },
        });
        return { ok: true, archivedVersionIds } as const;
      });
    },
  };
}
