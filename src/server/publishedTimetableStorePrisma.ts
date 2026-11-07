/**
 * Prisma read adapter for the accepted M4-T4a `PublishedTimetableStore` contract
 * (M4-T4b). It implements the six scoped reads the published-timetable service
 * uses and the one interactive read transaction that re-confirms a version is
 * still the unique current publication before returning its entries. Strictly
 * read-only: no method creates, updates, deletes or upserts anything.
 *
 * Read rules (each one is asserted against a real isolated SQLite file):
 * - `listPublishedVersionsBySemester` is WHERE-scoped to `semester` and
 *   `status: "PUBLISHED"`, ordered by id, and returns every matching row — it
 *   never picks a winner. Each stored status is parsed with the accepted schema;
 *   an unreadable status throws rather than being guessed. `publishedAt: null`
 *   is preserved so the service can report INVALID_PUBLISHED_DATA.
 * - Selector reads return stored ids/names/codes only. Lecturers join their
 *   linked User for the display name; `findLecturerByUserId` uses the real unique
 *   `Lecturer.userId` relation and returns null when absent — identity is never
 *   inferred from name, email, role or a browser-supplied selection. Venues are
 *   id-scoped with NO status filter: a venue that became MAINTENANCE or INACTIVE
 *   after publication is still the venue the entries reference, so it must not
 *   vanish from the selector or the projection (M3-T2a / M4-T3b do the same).
 * - `readPublishedEntries` is the consistency boundary. In ONE interactive read
 *   transaction it re-reads the semester's PUBLISHED versions, confirms exactly
 *   one remains, that its id is the requested version, its semester and status
 *   match and its publishedAt is non-null, then reads that version's entries and
 *   joins with the same transaction client and returns them together as
 *   `{ status: "current", version, entries }`. Any failed currency condition
 *   returns `{ status: "stale" }`; a Prisma/SQLite failure throws so the service
 *   reports INTERNAL_ERROR, never an empty or successful read.
 * - Entry joins map only real stored relationships (unit code/title, group
 *   id/name, lecturer id/name via Lecturer.user, venue code). Nothing is
 *   synthesized; a broken required relation propagates Prisma's failure. No
 *   password hash or authentication secret is ever selected.
 *
 * What the transaction actually guarantees, stated precisely (DECISIONS.md
 * M4-T4b): the version row and its entries are read from one coherent SQLite
 * snapshot, and the currency re-check happens inside that same snapshot.
 * "current" therefore means current AT THE TRANSACTION'S SNAPSHOT — not
 * permanently current. The service's earlier `listPublishedVersionsBySemester`
 * resolution is a separate read and is NOT atomic with this transaction; a
 * publication committed between the two is observed by the re-check and reported
 * as STALE. SQLite serializes writers per file, so this is an optimistic currency
 * re-check, not a lock and not a unique constraint (TimetableVersion has plain
 * indexes on semester and status, no one-PUBLISHED-per-semester constraint). It
 * cannot guarantee that no publication occurs after the transaction commits, and
 * no two-connection simultaneous-writer race is claimed. No migration, schema
 * change, raw SQL or lock is introduced to claim stronger consistency.
 *
 * `client` is injected so tests target an isolated SQLite file; production uses
 * the existing singleton. No page, grid, navigation or server action — M4-T4c.
 */
import { TimetableVersionStatusSchema } from "@/domain/types";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type {
  LecturerChoice,
  PublishedEntriesRead,
  PublishedEntryRow,
  PublishedTimetableStore,
  PublishedVersionRow,
  StudentGroupChoice,
  VenueChoice,
} from "@/server/publishedTimetableContract";

// ---------------------------------------------------------------------------
// Selects, ordering and scoped queries
// ---------------------------------------------------------------------------

const versionSelect = { id: true, semester: true, status: true, publishedAt: true } as const;

/** Only the joined display fields the contract needs — no secrets, no whole rows.
 *  Every relation here is required in the schema, so Prisma throws on a broken
 *  one rather than returning a fabricated null. */
const entrySelect = {
  id: true,
  versionId: true,
  teachingId: true,
  venueId: true,
  day: true,
  start: true,
  end: true,
  teaching: {
    select: {
      groupId: true,
      lecturerId: true,
      unit: { select: { code: true, title: true } },
      group: { select: { name: true } },
      lecturer: { select: { user: { select: { name: true } } } },
    },
  },
  venue: { select: { code: true } },
} as const;

const lecturerSelect = { id: true, userId: true, user: { select: { name: true } } } as const;

/** Every `id` tie-break keeps a repeated read byte-identical. The query builders
 *  stay un-annotated so Prisma infers each row's exact joined shape. */
const versionOrder: Prisma.TimetableVersionOrderByWithRelationInput = { id: "asc" };
const entryOrder: Prisma.TimetableEntryOrderByWithRelationInput[] = [{ day: "asc" }, { start: "asc" }, { id: "asc" }];

const publishedVersionsQuery = (semester: number) => ({
  where: { semester, status: "PUBLISHED" },
  orderBy: versionOrder,
  select: versionSelect,
});

const entriesOfVersionQuery = (versionId: string) => ({
  where: { versionId },
  orderBy: entryOrder,
  select: entrySelect,
});

// ---------------------------------------------------------------------------
// Row converters
// ---------------------------------------------------------------------------

type VersionDbRow = { id: string; semester: number; status: string; publishedAt: Date | null };

type EntryDbRow = {
  id: string;
  versionId: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
  teaching: {
    groupId: string;
    lecturerId: string;
    unit: { code: string; title: string };
    group: { name: string };
    lecturer: { user: { name: string } };
  };
  venue: { code: string };
};

type LecturerDbRow = { id: string; userId: string; user: { name: string } };

/** A stored status outside the declared values throws; nothing is guessed. */
function toVersionRow(row: VersionDbRow): PublishedVersionRow {
  return {
    id: row.id,
    semester: row.semester,
    status: TimetableVersionStatusSchema.parse(row.status),
    publishedAt: row.publishedAt,
  };
}

/** Real stored relationships only. The contract's joined fields are nullable so
 *  the service can fail closed; a required relation that Prisma cannot resolve
 *  throws before this runs, so no value here is ever synthesized. */
function toEntryRow(row: EntryDbRow): PublishedEntryRow {
  return {
    id: row.id,
    versionId: row.versionId,
    teachingId: row.teachingId,
    venueId: row.venueId,
    day: row.day,
    start: row.start,
    end: row.end,
    unitCode: row.teaching.unit.code,
    unitTitle: row.teaching.unit.title,
    groupId: row.teaching.groupId,
    groupName: row.teaching.group.name,
    lecturerId: row.teaching.lecturerId,
    lecturerName: row.teaching.lecturer.user.name,
    venueCode: row.venue.code,
  };
}

function toLecturerChoice(row: LecturerDbRow): LecturerChoice {
  return { id: row.id, userId: row.userId, displayName: row.user.name };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Prisma implementation of `PublishedTimetableStore`. The default client is the
 * shared singleton; tests inject a client bound to an isolated database file.
 * Every method is a scoped read — there is no write path and no extra role or
 * authorization policy here (that belongs to the accepted service).
 */
export function createPublishedTimetableStore(client: PrismaClient = prisma): PublishedTimetableStore {
  return {
    async listPublishedVersionsBySemester(semester): Promise<PublishedVersionRow[]> {
      const rows = await client.timetableVersion.findMany(publishedVersionsQuery(semester));
      return rows.map(toVersionRow);
    },

    /**
     * One interactive read transaction: re-confirm currency, then read the
     * version's entries and joins from the same snapshot. A failed currency
     * condition is `stale`; a Prisma/SQLite failure throws (never an empty read).
     * The service's earlier resolution is not an authority to skip this re-check.
     */
    async readPublishedEntries(versionId, semester): Promise<PublishedEntriesRead> {
      return client.$transaction(async (tx) => {
        const rows = await tx.timetableVersion.findMany(publishedVersionsQuery(semester));
        if (rows.length !== 1) return { status: "stale" } as const;
        const version = toVersionRow(rows[0]);
        if (
          version.id !== versionId ||
          version.semester !== semester ||
          version.status !== "PUBLISHED" ||
          version.publishedAt === null
        ) {
          return { status: "stale" } as const;
        }
        const entryRows = await tx.timetableEntry.findMany(entriesOfVersionQuery(versionId));
        const entries = entryRows.filter((row) => row.versionId === versionId).map(toEntryRow);
        return { status: "current", version, entries } as const;
      });
    },

    async listStudentGroups(): Promise<StudentGroupChoice[]> {
      return client.studentGroup.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, departmentId: true } });
    },

    async listLecturers(): Promise<LecturerChoice[]> {
      const rows = await client.lecturer.findMany({ orderBy: { id: "asc" }, select: lecturerSelect });
      return rows.map(toLecturerChoice);
    },

    async findLecturerByUserId(userId): Promise<LecturerChoice | null> {
      const row = await client.lecturer.findUnique({ where: { userId }, select: lecturerSelect });
      return row === null ? null : toLecturerChoice(row);
    },

    /** Id-scoped only: a venue's operational status is not this adapter's filter
     *  to apply, so a published entry's venue is never hidden by a status change. */
    async listTeachingAccess(semester) {
      return client.teaching.findMany({
        where: { unit: { semester } },
        orderBy: { id: "asc" },
        select: { groupId: true, lecturerId: true },
      });
    },

    async listVenues(): Promise<VenueChoice[]> {
      return client.venue.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true } });
    },
  };
}