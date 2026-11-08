/** One coherent, read-only Prisma transaction; never uses the M4 detail-view service. */
import { M6Error } from "./m6Errors";
import { readM6Snapshot } from "./m6Snapshot";
import { materializeDate, checkExceptions } from "@/domain/occurrences";
import { inTerm } from "@/domain/termCalendar";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { VenueStatusStore } from "./venueStatusContract";
export function createVenueStatusStore(client: PrismaClient): VenueStatusStore {
  const readSnapshot = async (semester: number,date?: string) => {
      return client.$transaction(async (tx) => {
        const versions = await tx.timetableVersion.findMany({
          where: { semester, status: "PUBLISHED" },
          select: { id: true, semester: true, status: true, publishedAt: true },
        });
        if (versions.length !== 1) return { versions, venues: [], entries: [] };
        if (date) {
          const s = await readM6Snapshot(tx,versions[0].id);
          checkExceptions(s.entries,s.exceptions,s.term);
          const applied = inTerm(date,s.term);
          // Outside the synthetic range, no actual institution availability claim.
          if (!applied && s.exceptions.length) throw new M6Error("DATE_OUT_OF_TERM");
          const effective = applied ? materializeDate(s.entries,s.exceptions,date,s.term) : s.entries;
          const venues = await tx.venue.findMany({ select: { id:true,code:true,type:true,status:true,unavailabilities:{ select:{ venueId:true,day:true,start:true,end:true } } } });
          return { versions,venues,actualDate:date,dateApplied:applied,entries:effective.map(e => ({ versionId:e.versionId,venueId:e.venueId,day:e.day,start:e.start,end:e.end,unitSemester:s.teachings.find(t => t.id === e.teachingId)?.unit.semester ?? null })) };
        }
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
    };
  return { readSnapshot,readDatedSnapshot:readSnapshot };
}
