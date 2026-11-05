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

export function createDraftValidationStore(): DraftValidationStore {
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
  };
}
