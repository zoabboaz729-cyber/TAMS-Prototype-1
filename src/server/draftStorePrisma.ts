/**
 * Prisma implementation of the M3-T2a draft validation store.
 *
 * Read-only: every method is a find/select over the existing models
 * (TimetableVersion, TimetableEntry, Teaching + Unit, Venue,
 * LecturerAvailability, VenueUnavailable). No migration, no writes.
 *
 * A stored status that is not one of the values declared in
 * src/domain/types.ts makes `findVersion` throw rather than guess: a corrupt
 * status must surface as a load failure, never be treated as a DRAFT (or read
 * as "not a draft" when the real problem is unreadable data). Venue and unit
 * type strings are passed through untouched — comparing them is the
 * validator's rule, not a status enum.
 */
import { TimetableVersionStatusSchema } from "@/domain/types";
import type {
  DraftValidationStore,
  DraftVersionRow,
  TeachingRow,
} from "@/server/draftValidation";
import type {
  DraftMoveStore,
  MoveAuditDraft,
  MoveFields,
} from "@/server/draftMove";
import { prisma } from "@/server/db";

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
  unit: { select: { code: true, venueTypeRequired: true } },
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

/** The subset of a Teaching row the validators' mappers read. */
type TeachingDbRow = {
  id: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  unit: { code: string; venueTypeRequired: string };
};

function toVersionRow(row: { id: string; semester: number; status: string }): DraftVersionRow {
  return {
    id: row.id,
    semester: row.semester,
    status: TimetableVersionStatusSchema.parse(row.status),
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

/** Rows the validator must never see: `available: true` restricts nothing. */
const lecturerUnavailableWhere = { available: false } as const;

const venueIdSelect = { id: true } as const;

/**
 * Builds one object satisfying both the read (DraftValidationStore) and move
 * (DraftMoveStore) interfaces so the two factory exports share a single set
 * of Prisma queries. `findVersion` is shared by both contracts.
 */
function buildDraftStore(): DraftValidationStore & DraftMoveStore {
  return {
    async findVersion(versionId) {
      const row = await prisma.timetableVersion.findUnique({
        where: { id: versionId },
        select: versionSelect,
      });
      return row === null ? null : toVersionRow(row);
    },

    async listEntriesByVersion(versionId) {
      // Day, start, id keeps the query stable; the loader re-orders into the
      // policy day sequence that the editor's row index follows.
      return prisma.timetableEntry.findMany({
        where: { versionId },
        orderBy: [{ day: "asc" }, { start: "asc" }, { id: "asc" }],
        select: entrySelect,
      });
    },

    async listTeachingsByIds(teachingIds) {
      const rows = await prisma.teaching.findMany({
        where: { id: { in: [...teachingIds] } },
        orderBy: { id: "asc" },
        select: teachingSelect,
      });
      return rows.map(toTeachingRow);
    },

    async listVenuesByIds(venueIds) {
      return prisma.venue.findMany({
        where: { id: { in: [...venueIds] } },
        orderBy: { id: "asc" },
        select: venueSelect,
      });
    },

    async listLecturerUnavailableByLecturerIds(lecturerIds) {
      return prisma.lecturerAvailability.findMany({
        where: { lecturerId: { in: [...lecturerIds] }, ...lecturerUnavailableWhere },
        orderBy: [{ lecturerId: "asc" }, { day: "asc" }, { start: "asc" }],
        select: lecturerUnavailableSelect,
      });
    },

    async listVenueUnavailableByVenueIds(venueIds) {
      return prisma.venueUnavailable.findMany({
        where: { venueId: { in: [...venueIds] } },
        orderBy: [{ venueId: "asc" }, { day: "asc" }, { start: "asc" }],
        select: venueUnavailableSelect,
      });
    },

    async findEntry(entryId) {
      return prisma.timetableEntry.findUnique({
        where: { id: entryId },
        select: entrySelect,
      });
    },

    async findVenueById(venueId) {
      const row = await prisma.venue.findUnique({
        where: { id: venueId },
        select: venueIdSelect,
      });
      return row === null ? null : { id: row.id };
    },

    /**
     * Compare-and-set move inside one transaction:
     * 1. Re-read the version; if it is gone or no longer DRAFT, the pre-state
     *    changed under us → stale (a concurrent publish).
     * 2. updateMany scoped by id + versionId + locked=false. If zero rows
     *    match, the entry was locked, moved to another version, or deleted
     *    during the operation → stale.
     * 3. Write the audit row only after the update succeeds.
     * A corrupt stored status is parsed and rejected rather than guessed.
     */
    async moveEntry(entryId, expectedVersionId, fields, audit) {
      return prisma.$transaction(async (tx) => {
        const version = await tx.timetableVersion.findUnique({
          where: { id: expectedVersionId },
          select: versionSelect,
        });
        if (version === null) return { stale: true } as const;
        const parsed = TimetableVersionStatusSchema.safeParse(version.status);
        if (!parsed.success || parsed.data !== "DRAFT") {
          return { stale: true } as const;
        }

        const result = await tx.timetableEntry.updateMany({
          where: { id: entryId, versionId: expectedVersionId, locked: false },
          data: {
            day: fields.day,
            start: fields.start,
            end: fields.end,
            venueId: fields.venueId,
          },
        });
        if (result.count === 0) return { stale: true } as const;

        await tx.auditLog.create({
          data: {
            actorId: audit.actorId,
            action: audit.action,
            entity: "TimetableEntry",
            entityId: entryId,
            reason: audit.reason,
          },
        });
        return { ok: true } as const;
      });
    },
  };
}

/** Read-only store for the M3-T2a draft validation loader. */
export function createDraftValidationStore(): DraftValidationStore {
  return buildDraftStore();
}

/** Read + write store for the M3-T2b1 draft entry move. */
export function createDraftMoveStore(): DraftMoveStore {
  return buildDraftStore();
}
