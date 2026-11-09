import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { m7Fixture, lecturer, student, actor, ref, runtime, clock, resultValue } from "./m7Fixture";
import { openAttendance, scanAttendance, lecturerCredential } from "../attendanceService";
import { reportClassActivity } from "../classActivity";
import { attendanceReports, attendanceSummary } from "../attendanceReports";
import { lecturerAttendanceList, studentAttendanceList } from "../attendanceReads";
import { readVenueStatus } from "../venueStatus";
import { createVenueStatusStore } from "../venueStatusStorePrisma";
import { attendanceRuntime } from "../attendanceRuntime";
let f: Awaited<ReturnType<typeof m7Fixture>>;
beforeAll(async () => { f = await m7Fixture(); }, 60000);
beforeEach(async () => f.reset());
afterAll(async () => f?.close());
async function marked(owner = lecturer, selection = ref, time = clock) { const rt = runtime(time), id = resultValue(await openAttendance(f.db, owner, selection, rt)).sessionId; const c = resultValue(await lecturerCredential(f.db, owner, id, rt)); resultValue(await scanAttendance(f.db, student, { method: "CODE", sessionId: id, code: c.code }, rt)); return id; }
it("totals match independent SQL and participants are distinct across sessions", async () => {
    await marked();
    await marked(lecturer, { ...ref, originalDate: "2026-11-16" }, new Date("2026-11-16T06:15:00Z"));
    const report = resultValue(await attendanceReports(f.db, lecturer, {}));
    const raw = await f.db.$queryRawUnsafe<Array<{
        n: bigint;
    }>>("SELECT COUNT(*) AS n FROM AttendanceRecord");
    expect(report.totals[0]).toMatchObject({ marks: Number(raw[0].n), distinctParticipants: 1, sessions: 2 });
    expect(report.rows[0]).toMatchObject({ plannedGroupSize: 45, provisionedAccounts: 2 });
    expect(report.rows.flatMap(r => r.records)).toHaveLength(2);
});
it.each(["APPROVER", "DEPT_REP"] as const)("%s report uses student-group department, even service lecturer from Maths", async (role) => {
    const id = await marked(actor("LECTURER", "lecturer2", "d2"), { ...ref, sourceEntryId: "e2" }, new Date("2026-11-09T07:15:00Z"));
    const own = resultValue(await attendanceReports(f.db, actor(role), {}));
    expect(own.totalSessions).toBe(1);
    expect(own.rows[0].id).toBe(id);
    expect(own.rows[0].records).toEqual([]);
    expect(resultValue(await attendanceReports(f.db, actor(role, role.toLowerCase(), "d2"), {})).totalSessions).toBe(1); // actor department must be re-read from DB, forged hint ignored
    await f.db.user.update({ where: { id: role.toLowerCase() }, data: { departmentId: "d2" } });
    expect(resultValue(await attendanceReports(f.db, actor(role, role.toLowerCase(), "d2"), {})).totalSessions).toBe(0);
    await f.db.user.update({ where: { id: role.toLowerCase() }, data: { departmentId: "d" } });
});
it("student history excludes peers, denominators, and guessed session details", async () => { const id = await marked(); const own = resultValue(await attendanceReports(f.db, student, {})); expect(own.rows[0].records[0].name).toBe("Your attendance"); expect(own.rows[0].provisionedAccounts).toBeNull(); expect(own.activities).toEqual([]); expect(resultValue(await attendanceReports(f.db, actor("STUDENT", "student2"), {})).rows).toEqual([]); expect(await attendanceSummary(f.db, student, id)).toMatchObject({ code: "FORBIDDEN" }); });
it("ADMIN cannot report; colleague lecturer cannot get session summaries or report", async () => { const id = await marked(); expect(await attendanceReports(f.db, actor("ADMIN"), {})).toMatchObject({ code: "FORBIDDEN" }); expect(await attendanceReports(f.db, null, {})).toMatchObject({ code: "UNAUTHENTICATED" }); expect(await attendanceReports(f.db, actor("LECTURER", "lecturer2", "d2"), { sessionId: id })).toMatchObject({ code: "NOT_FOUND" }); expect(await attendanceSummary(f.db, actor("LECTURER", "lecturer2", "d2"), id)).toMatchObject({ code: "NOT_FOUND" }); });
it("Start-only is reportable without attendance", async () => { await reportClassActivity(f.db, lecturer, { ...ref, confirmVenue: true }, "START", clock); const r = resultValue(await attendanceReports(f.db, lecturer, {})); expect(r.rows).toEqual([]); expect(r.activities).toHaveLength(1); expect(r.activities[0].state).toBe("REPORTED_STARTED"); });
it("filters are strict, inclusive and empty form values work", async () => { await marked(); expect(resultValue(await attendanceReports(f.db, lecturer, { from: "2026-11-09", to: "2026-11-09" })).totalSessions).toBe(1); expect(resultValue(await attendanceReports(f.db, lecturer, { from: "", to: "", unitId: "" })).totalSessions).toBe(1); for (const q of [{ from: "2026-02-30" }, { page: "-1" }, { studentId: "other" }, { from: "2026-11-10", to: "2026-11-09" }])
    expect(await attendanceReports(f.db, lecturer, q)).toMatchObject({ code: "INVALID_INPUT" }); });
it("archived history remains scoped and reportable", async () => { await marked(); await f.db.timetableVersion.update({ where: { id: "p" }, data: { status: "ARCHIVED" } }); expect(resultValue(await attendanceReports(f.db, lecturer, {})).totals[0].marks).toBe(1); });
it("live M5 overlay preserves reservation, hides identities, and ignores URL demos", async () => {
    const board = () => readVenueStatus(lecturer, {}, createVenueStatusStore(f.db, true), () => clock);
    let r = await board();
    if (!r.ok)
        throw new Error(JSON.stringify(r));
    expect(r.rows.find(v => v.code === "R1")?.activityLabel).toContain("Reserved");
    const id = resultValue(await openAttendance(f.db, lecturer, ref, runtime())).sessionId;
    r = await board();
    if (!r.ok)
        throw new Error();
    expect(r.rows.find(v => v.code === "R1")?.activityLabel).toContain("class start unconfirmed");
    await reportClassActivity(f.db, lecturer, { ...ref, confirmVenue: true }, "START", clock);
    r = await board();
    if (!r.ok)
        throw new Error();
    expect(r.rows.find(v => v.code === "R1")?.activityLabel).toContain("lecturer-reported");
    await reportClassActivity(f.db, lecturer, ref, "END", clock);
    r = await board();
    if (!r.ok)
        throw new Error();
    expect(r.rows.find(v => v.code === "R1")).toMatchObject({ status: "OCCUPIED" });
    expect(JSON.stringify(r)).not.toMatch(/studentId|startedBy|deviceId|sessionId|password|synthetic@/);
    const demo = await readVenueStatus(actor("OFFICER"), { mode: "demo-date", date: ref.originalDate, time: "09:15" }, createVenueStatusStore(f.db, true), () => clock);
    if (!demo.ok)
        throw new Error();
    expect(demo.rows[0].activityLabel).toBeUndefined();
    await f.db.venue.update({ where: { id: "r" }, data: { status: "MAINTENANCE" } });
    r = await board();
    if (!r.ok)
        throw new Error();
    expect(r.rows.find(v => v.code === "R1")?.activityLabel).toContain("Operational closure");
    expect(await f.db.attendanceSession.findUnique({ where: { id } })).toMatchObject({ status: "OPEN" });
});
it("own lecturer list and own-group session list do not enumerate other classes", async () => { const id = await marked(); const l = resultValue(await lecturerAttendanceList(f.db, lecturer, runtime())); expect(l.rows.map(r => r.sourceEntryId)).toEqual(["e"]); const s = resultValue(await studentAttendanceList(f.db, student, runtime())); expect(s[0]).toMatchObject({ id, recorded: true }); expect(resultValue(await studentAttendanceList(f.db, actor("STUDENT", "wrongstudent", "d2", "g2"), runtime()))).toEqual([]); });
it("demo runtime needs all independent gates and never mutates real class clock", () => {
    const env = { NODE_ENV: "development", ATTENDANCE_TOKEN_SECRET: "x".repeat(64), DEMO_MODE: "true", M7_SYNTHETIC_DEMO: "true", DATABASE_URL: "file:/tmp/m7-demo-test.db", M7_DEMO_OFFSET_MINUTES: "60" };
    const r = attendanceRuntime(env, clock);
    expect(r.now.getTime() - r.realNow.getTime()).toBe(3600000);
    for (const change of [{ NODE_ENV: "production" }, { DATABASE_URL: "file:/tmp/dev.db" }, { DEMO_MODE: "false" }, { M7_DEMO_OFFSET_MINUTES: "NaN" }])
        expect(() => attendanceRuntime({ ...env, ...change }, clock)).toThrow();
});
