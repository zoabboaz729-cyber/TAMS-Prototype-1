import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { m7Fixture, lecturer, officer, ref, runtime, clock, resultValue } from "./m7Fixture";
import { openAttendance } from "../attendanceService";
import { reportClassActivity } from "../classActivity";
import { performDraftPublish } from "../draftPublish";
import { createDraftPublishStore } from "../draftPublishStorePrisma";
import { DEFAULT_POLICY } from "@/domain/policy";
import { hasActiveAttendance } from "../attendancePublication";
let f: Awaited<ReturnType<typeof m7Fixture>>;
beforeAll(async () => { f = await m7Fixture(); }, 60000);
beforeEach(async () => f.reset());
afterAll(async () => f?.close());
const publish = (now = clock) => performDraftPublish(createDraftPublishStore(f.db), officer, { versionId: "draft" }, DEFAULT_POLICY, () => now);
it.each(["QR", "CLASS"])("same-semester publish gate refuses active %s and retains history after scheduled end", async (kind) => {
    if (kind === "QR")
        resultValue(await openAttendance(f.db, lecturer, ref, runtime()));
    else
        resultValue(await reportClassActivity(f.db, lecturer, { ...ref, confirmVenue: true }, "START", clock));
    expect((await publish()).ok).toBe(false);
    expect((await f.db.timetableVersion.findUniqueOrThrow({ where: { id: "p" } })).status).toBe("PUBLISHED");
    expect((await publish(new Date("2026-11-09T07:00:00Z"))).ok).toBe(true);
    expect((await f.db.timetableVersion.findUniqueOrThrow({ where: { id: "p" } })).status).toBe("ARCHIVED");
    expect(kind === "QR" ? await f.db.attendanceSession.count() : await f.db.classOccurrenceActivity.count()).toBe(1);
});
it("other semester does not inherit active-class block", async () => { await openAttendance(f.db, lecturer, ref, runtime()); expect(await f.db.$transaction(tx => hasActiveAttendance(tx, ["draft"], clock))).toBe(false); });
it("race between open and publish cannot leave an accepted live scan on archived source", async () => {
    const outcomes = await Promise.all([openAttendance(f.db, lecturer, ref, runtime()), publish()]);
    const p = await f.db.timetableVersion.findUniqueOrThrow({ where: { id: "p" } });
    if (outcomes[0].ok && outcomes[1].ok)
        throw new Error("both conflicting operations committed");
    if (outcomes[0].ok)
        expect(p.status).toBe("PUBLISHED");
    expect(await f.db.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]);
});

it("publication rechecks active state at transaction time rather than an earlier preview instant",async()=>{
 resultValue(await openAttendance(f.db,lecturer,ref,runtime()));
 const previewBeforeClass=new Date("2026-11-09T05:59:59Z");
 const outcome=await performDraftPublish(createDraftPublishStore(f.db,()=>clock),officer,{versionId:"draft"},DEFAULT_POLICY,()=>previewBeforeClass);
 expect(outcome.ok).toBe(false);expect((await f.db.timetableVersion.findUniqueOrThrow({where:{id:"p"}})).status).toBe("PUBLISHED");
});
