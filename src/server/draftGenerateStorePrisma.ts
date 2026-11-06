/**
 * Prisma adapter for the accepted M4-T2a `DraftGenerateStore` contract
 * (M4-T2b). It implements the six scoped reads the generate service may ask
 * for and the single atomic write that turns a finished, independently
 * validated board into a NEW DRAFT `TimetableVersion`.
 *
 * Read rules (each one is asserted against a real database):
 * - `listTeachingsForSemester` selects only teachings whose unit is in the
 *   requested semester AND `scheduled: true` (ASSUMPTION-16 — an unscheduled
 *   unit is never timetabled). `semesterExists` comes from a separate Unit
 *   count, so a semester that has units but no scheduled teaching stays a
 *   real, empty answer instead of an unknown semester. A corrupt row cannot
 *   hide: the service re-checks every row and reports DATASET_SCOPE_MISMATCH
 *   as defence in depth (M4-T2a decision (c)) — the filter here is correct by
 *   construction, not the only guard.
 * - Only `ACTIVE` venues are eligible; INACTIVE and MAINTENANCE rows are
 *   excluded at the database.
 * - Lecturer blocking periods are stored rows with `available: false`.
 *   `available: true` restricts nothing and must never reach the generator
 *   as a block.
 * - Locked rows are queried with `versionId` AND `locked: true` together, so
 *   another version's rows or unlocked proposals can never become fixed.
 * - Every read goes straight to Prisma. A failed query throws and the
 *   service converts it to INTERNAL_ERROR; nothing here substitutes an
 *   empty array for data that could not be read.
 *
 * Persistence rules for `persistGeneratedDraft` (one interactive
 * transaction):
 * - The source token is re-verified INSIDE the same transaction that creates
 *   the new version — existence, DRAFT status, semester scope, and a
 *   recomputed `lockedFingerprint` using the accepted contract helper. Any
 *   mismatch rolls back and answers `{ stale: true }`: no version, entry or
 *   audit row is created, and changed source data is never silently
 *   regenerated from.
 * - A corrupt stored status throws (parsed, never guessed) instead of being
 *   reported as stale, so unexpected database problems are not hidden as
 *   stale requests.
 * - The new version is always `status: "DRAFT"` with the requested semester
 *   and the authenticated `createdBy` from the accepted service. Nothing
 *   publishes or archives, and the source version and its entries are never
 *   touched.
 * - Entries are inserted under the new version id with fresh database ids;
 *   each row keeps the payload's `locked` boolean. `sourceEntryId` has no
 *   `TimetableEntry` column, so every copied locked row also produces one
 *   `TIMETABLE_LOCKED_ENTRY_COPY` audit record mapping
 *   `sourceEntryId@sourceVersionId -> new entry id`. One event per row —
 *   never an unbounded list packed into one message.
 * - The main `TIMETABLE_DRAFT_GENERATE` audit row and all mapping rows are
 *   part of the same transaction. If any required write fails — a missing
 *   teaching, venue, creator, or an audit insert — Prisma rolls the whole
 *   transaction back and the error throws; the service converts it to
 *   INTERNAL_ERROR. `{ ok: true, versionId }` is returned only after the
 *   commit succeeded.
 *
 * `client` is injected so integration tests can target an isolated SQLite
 * file; production uses the existing singleton. No migration, no schema
 * change, no new table.
 */
import { TimetableVersionStatusSchema } from "@/domain/types";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type {
  DraftEntryRow,
  DraftVersionRow,
  LecturerUnavailableRow,
  VenueRow,
  VenueUnavailableRow,
} from "@/server/draftValidation";
import {
  lockedFingerprint,
  type DraftGenerateStore,
  type GenerateAuditDraft,
  type GeneratedDraftPayload,
  type GenerationTeachingRow,
  type SemesterTeachingRead,
} from "@/server/draftGenerateContract";

// ---------------------------------------------------------------------------
// Selects and row converters
// ---------------------------------------------------------------------------

const versionSelect = {
  id: true,
  semester: true,
  status: true,
} as const;

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
  sessionsPerWeek: true,
  sessionLength: true,
  unit: {
    select: {
      code: true,
      semester: true,
      scheduled: true,
      venueTypeRequired: true,
    },
  },
} as const;

const venueSelect = {
  id: true,
  code: true,
  capacity: true,
  type: true,
} as const;

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

/** The subset of a joined Teaching row this adapter reads. */
type TeachingDbRow = {
  id: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  sessionsPerWeek: number;
  sessionLength: number;
  unit: {
    code: string;
    semester: number;
    scheduled: boolean;
    venueTypeRequired: string;
  };
};

/**
 * A stored status outside the values declared in src/domain/types.ts throws
 * rather than being guessed — same rule as the accepted M3 draft adapter. A
 * corrupt status must surface as INTERNAL_ERROR, never as `{ stale: true }`,
 * because that would hide a data problem as a concurrency answer.
 */
function toVersionRow(row: { id: string; semester: number; status: string }): DraftVersionRow {
  return {
    id: row.id,
    semester: row.semester,
    status: TimetableVersionStatusSchema.parse(row.status),
  };
}

function toGenerationTeachingRow(row: TeachingDbRow): GenerationTeachingRow {
  return {
    id: row.id,
    lecturerId: row.lecturerId,
    groupId: row.groupId,
    expectedSize: row.expectedSize,
    unitCode: row.unit.code,
    venueTypeRequired: row.unit.venueTypeRequired,
    sessionsPerWeek: row.sessionsPerWeek,
    sessionLength: row.sessionLength,
    semester: row.unit.semester,
    scheduled: row.unit.scheduled,
  };
}

/**
 * The locked rows of one version, in the one order this adapter always
 * returns them. `locked: true` is part of the WHERE clause, not a filter
 * applied afterwards, so an unlocked proposal or another version's row can
 * never become a fixed session.
 */
function lockedEntriesWhere(versionId: string): Prisma.TimetableEntryFindManyArgs {
  return {
    where: { versionId, locked: true },
    orderBy: [{ day: "asc" }, { start: "asc" }, { id: "asc" }],
    select: entrySelect,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Prisma implementation of `DraftGenerateStore`. The default client is the
 * shared singleton; tests inject a client bound to an isolated database.
 */
export function createDraftGenerateStore(client: PrismaClient = prisma): DraftGenerateStore {
  return {
    async findVersion(versionId): Promise<DraftVersionRow | null> {
      const row = await client.timetableVersion.findUnique({
        where: { id: versionId },
        select: versionSelect,
      });
      return row === null ? null : toVersionRow(row);
    },

    async listLockedEntriesByVersion(versionId): Promise<DraftEntryRow[]> {
      return client.timetableEntry.findMany(lockedEntriesWhere(versionId));
    },

    async listTeachingsForSemester(semester): Promise<SemesterTeachingRead> {
      const rows = await client.teaching.findMany({
        where: { unit: { semester, scheduled: true } },
        orderBy: { id: "asc" },
        select: teachingSelect,
      });
      // Existence is about Units, independent of whether any scheduled
      // teaching exists: a semester with units but no teachings is empty,
      // not unknown.
      const unitCount = await client.unit.count({ where: { semester } });
      return { semesterExists: unitCount > 0, teachings: rows.map(toGenerationTeachingRow) };
    },

    async listActiveVenues(): Promise<VenueRow[]> {
      return client.venue.findMany({
        where: { status: "ACTIVE" },
        orderBy: { id: "asc" },
        select: venueSelect,
      });
    },

    async listLecturerUnavailableByLecturerIds(
      lecturerIds,
    ): Promise<LecturerUnavailableRow[]> {
      return client.lecturerAvailability.findMany({
        where: { lecturerId: { in: [...lecturerIds] }, available: false },
        orderBy: [{ lecturerId: "asc" }, { day: "asc" }, { start: "asc" }, { id: "asc" }],
        select: lecturerUnavailableSelect,
      });
    },

    async listVenueUnavailableByVenueIds(venueIds): Promise<VenueUnavailableRow[]> {
      return client.venueUnavailable.findMany({
        where: { venueId: { in: [...venueIds] } },
        orderBy: [{ venueId: "asc" }, { day: "asc" }, { start: "asc" }, { id: "asc" }],
        select: venueUnavailableSelect,
      });
    },

    /**
     * One atomic operation: re-verify the source token, create the DRAFT
     * version, insert every entry, then write the main audit row plus one
     * `TIMETABLE_LOCKED_ENTRY_COPY` mapping row per copied locked entry — or
     * nothing. Stale rejections answer before any write; every other failure
     * throws after a full rollback for the service to convert into
     * INTERNAL_ERROR.
     */
    async persistGeneratedDraft(
      payload: GeneratedDraftPayload,
      audit: GenerateAuditDraft,
    ): Promise<{ ok: true; versionId: string } | { stale: true }> {
      return client.$transaction(async (tx) => {
        if (payload.expectedSource !== null) {
          const source = await tx.timetableVersion.findUnique({
            where: { id: payload.expectedSource.versionId },
            select: versionSelect,
          });
          if (source === null) return { stale: true } as const;
          const parsed = TimetableVersionStatusSchema.safeParse(source.status);
          if (!parsed.success) {
            throw new Error(
              `Source version ${source.id} has a corrupt status; refusing to guess.`,
            );
          }
          if (parsed.data !== "DRAFT" || source.semester !== payload.semester) {
            return { stale: true } as const;
          }
          const currentLocked = await tx.timetableEntry.findMany(
            lockedEntriesWhere(payload.expectedSource.versionId),
          );
          if (lockedFingerprint(currentLocked) !== payload.expectedSource.lockedFingerprint) {
            return { stale: true } as const;
          }
        }

        const version = await tx.timetableVersion.create({
          data: {
            semester: payload.semester,
            status: payload.status,
            createdBy: payload.createdBy,
          },
          select: { id: true },
        });

        const copied: { newEntryId: string; sourceEntryId: string }[] = [];
        for (const entry of payload.entries) {
          const created = await tx.timetableEntry.create({
            data: {
              versionId: version.id,
              teachingId: entry.teachingId,
              venueId: entry.venueId,
              day: entry.day,
              start: entry.start,
              end: entry.end,
              locked: entry.locked,
            },
            select: { id: true },
          });
          if (entry.sourceEntryId !== null) {
            copied.push({ newEntryId: created.id, sourceEntryId: entry.sourceEntryId });
          }
        }

        await tx.auditLog.create({
          data: {
            actorId: audit.actorId,
            action: audit.action,
            entity: audit.entity,
            entityId: version.id,
            reason: audit.reason,
          },
        });

        const sourceVersionId = payload.expectedSource?.versionId ?? payload.sourceVersionId;
        for (const row of copied) {
          await tx.auditLog.create({
            data: {
              actorId: audit.actorId,
              action: "TIMETABLE_LOCKED_ENTRY_COPY",
              entity: "TimetableEntry",
              entityId: row.newEntryId,
              reason: `Copied locked entry ${row.sourceEntryId} from source version ${
                sourceVersionId ?? "unknown"
              } to new entry ${row.newEntryId} in version ${version.id}.`,
            },
          });
        }

        return { ok: true, versionId: version.id } as const;
      });
    },
  };
}
