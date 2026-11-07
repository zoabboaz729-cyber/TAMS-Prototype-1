/** One coherent, read-only Prisma transaction; never uses the M4 detail-view service. */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { VenueStatusStore } from "./venueStatusContract";
export function createVenueStatusStore(client: PrismaClient): VenueStatusStore {
  return {
    async readSnapshot(semester) {
      return client.$transaction(async (tx) => {
        const versions = await tx.timetableVersion.findMany({
          where: { semester, status: "PUBLISHED" },
          select: { id: true, semester: true, status: true, publishedAt: true },
        });
        if (versions.length !== 1) return { versions, venues: [], entries: [] };
        const venues = await tx.venue.findMany({
          select: { id: true, code: true, type: true, status: true,
            unavailabilities: { select: { venueId: true, day: true, start: true, end: true } } },
        });
        // LEFT joins preserve corrupt/missing teaching/unit links as null rather than
        // silently dropping sessions. No teaching identifiers or personal fields selected.
        // Parameters are bound through Prisma.sql, never concatenated into SQL.
        const entries = await tx.$queryRaw(Prisma.sql`
          SELECT e."versionId", e."venueId", e."day", e."start", e."end", u."semester" AS "unitSemester"
          FROM "TimetableEntry" e
          LEFT JOIN "Teaching" t ON t."id" = e."teachingId"
          LEFT JOIN "Unit" u ON u."id" = t."unitId"
          WHERE e."versionId" = ${versions[0].id}
        `);
        return { versions, venues, entries };
      });
    },
  };
}
