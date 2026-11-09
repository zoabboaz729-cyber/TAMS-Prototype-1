/** Disposable synthetic fixtures only; cleanup removes only this mkdtemp directory. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_ATTENDANCE_POLICY } from "@/domain/attendanceRules";
export const clock = new Date("2026-11-09T06:15:00Z"); // Monday 09:15 Nairobi
export const key = "synthetic-test-key-".repeat(4);
export const runtime = (now = clock, simulated = false) => ({ secret: key, now, realNow: now, simulated, policy: DEFAULT_ATTENDANCE_POLICY });
export const actor = (role: Actor["role"], id = role.toLowerCase(), departmentId: string | null = "d", studentGroupId: string | null = role === "STUDENT" ? "g" : null): Actor => ({ id, role, departmentId, studentGroupId });
export const lecturer = actor("LECTURER"), student = actor("STUDENT"), officer = actor("OFFICER");
export const ref = { sourceEntryId: "e", originalDate: "2026-11-09" };
export function resultValue<T>(r: {
    ok: true;
    value: T;
} | {
    ok: false;
}): T { if (!r.ok)
    throw new Error(JSON.stringify(r)); return r.value; }
export async function m7Fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), "tams-m7-")), url = `file:${path.join(dir, "test.db")}`;
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info" }, stdio: "pipe", timeout: 60000 });
    const db = new PrismaClient({ datasources: { db: { url } } });
    await db.department.createMany({ data: [{ id: "d", name: "Computing", schoolId: "s" }, { id: "d2", name: "Maths", schoolId: "s" }] });
    await db.studentGroup.createMany({ data: [{ id: "g", name: "SE-Y4", size: 45, departmentId: "d" }, { id: "g2", name: "M-Y2", size: 20, departmentId: "d2" }] });
    for (const role of ["OFFICER", "LECTURER", "STUDENT", "ADMIN", "APPROVER", "DEPT_REP"] as const)
        await db.user.create({ data: { id: role.toLowerCase(), name: role, email: `${role.toLowerCase()}@demo.tams.test`, passwordHash: "synthetic-only", role, departmentId: "d", studentGroupId: role === "STUDENT" ? "g" : null } });
    await db.user.createMany({ data: [{ id: "lecturer2", name: "L2", email: "l2@demo.tams.test", passwordHash: "x", role: "LECTURER", departmentId: "d2" }, { id: "student2", name: "S2", email: "s2@demo.tams.test", passwordHash: "x", role: "STUDENT", departmentId: "d", studentGroupId: "g" }, { id: "wrongstudent", name: "Wrong", email: "wrong@demo.tams.test", passwordHash: "x", role: "STUDENT", departmentId: "d2", studentGroupId: "g2" }] });
    await db.lecturer.createMany({ data: [{ id: "l", userId: "lecturer", departmentId: "d" }, { id: "l2", userId: "lecturer2", departmentId: "d2" }] });
    await db.unit.createMany({ data: [{ id: "u", code: "U1", title: "Synthetic unit", departmentId: "d", semester: 1, hoursPerWeek: 1, venueTypeRequired: "ROOM" }, { id: "u2", code: "U2", title: "Service unit", departmentId: "d2", semester: 1, hoursPerWeek: 1, venueTypeRequired: "ROOM" }] });
    await db.teaching.createMany({ data: [{ id: "t", unitId: "u", lecturerId: "l", groupId: "g", expectedSize: 45, sessionsPerWeek: 1, sessionLength: 1 }, { id: "t2", unitId: "u2", lecturerId: "l2", groupId: "g", expectedSize: 45, sessionsPerWeek: 1, sessionLength: 1 }] });
    await db.venue.createMany({ data: [{ id: "r", code: "R1", type: "ROOM", capacity: 60 }, { id: "r2", code: "R2", type: "ROOM", capacity: 60 }] });
    async function reset() {
        await db.attendanceAttempt.deleteMany();
        await db.attendanceRecord.deleteMany();
        await db.attendanceSession.deleteMany();
        await db.classOccurrenceActivity.deleteMany();
        await db.auditLog.deleteMany();
        await db.rescheduleRequest.deleteMany();
        await db.timetableOccurrenceException.deleteMany();
        await db.timetableEntry.deleteMany();
        await db.timetableVersion.updateMany({ data: { basePublishedVersionId: null } });
        await db.timetableVersion.deleteMany();
        await db.venueUnavailable.deleteMany();
        await db.venue.updateMany({ data: { status: "ACTIVE" } });
        await db.timetableVersion.createMany({ data: [{ id: "p", semester: 1, status: "PUBLISHED", publishedAt: new Date("2026-09-01"), createdBy: "officer" }, { id: "draft", semester: 1, status: "DRAFT", createdBy: "officer" }] });
        await db.timetableEntry.createMany({ data: [{ id: "e", versionId: "p", teachingId: "t", venueId: "r", day: "MON", start: "09:00", end: "10:00" }, { id: "e2", versionId: "p", teachingId: "t2", venueId: "r2", day: "MON", start: "10:00", end: "11:00" }, { id: "de", versionId: "draft", teachingId: "t", venueId: "r", day: "MON", start: "09:00", end: "10:00" }] });
    }
    await reset();
    return { db, url, dir, reset, async close() { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}
export function auditFailure(client: PrismaClient): PrismaClient {
    return new Proxy(client, { get(target, key, receiver) { if (key !== "$transaction")
            return Reflect.get(target, key, receiver); return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => fn(new Proxy(tx, { get(t, k, r) { return k === "auditLog" ? { create: () => { throw new Error("injected audit failure"); } } : Reflect.get(t, k, r); } }))); } });
}
