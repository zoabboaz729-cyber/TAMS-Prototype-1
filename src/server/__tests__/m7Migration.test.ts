import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { it, expect } from "vitest";
it("M6 upgrade preserves every legacy field including undated attendance, with no invented dates", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tams-m7-upgrade-")), url = `file:${path.join(dir, "upgrade.db")}`;
    const m = path.join(dir, "migrations");
    mkdirSync(m);
    copyFileSync("prisma/schema.prisma", path.join(dir, "schema.prisma"));
    copyFileSync("prisma/migrations/migration_lock.toml", path.join(m, "migration_lock.toml"));
    const copy = (name: string) => { mkdirSync(path.join(m, name), { recursive: true }); copyFileSync(path.join("prisma/migrations", name, "migration.sql"), path.join(m, name, "migration.sql")); };
    const names = readdirSync("prisma/migrations").filter(n => n !== "migration_lock.toml");
    names.filter(n => !n.includes("_m7_")).forEach(copy);
    const deploy = () => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", path.join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info" }, stdio: "pipe", timeout: 60000 });
    deploy();
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
        await db.department.create({ data: { id: "d", name: "D", schoolId: "s" } });
        await db.user.create({ data: { id: "u", name: "Synthetic", email: "synthetic@demo.tams.test", passwordHash: "x", role: "LECTURER" } });
        await db.lecturer.create({ data: { id: "l", userId: "u", departmentId: "d" } });
        await db.studentGroup.create({ data: { id: "g", name: "G", size: 45, departmentId: "d" } });
        await db.unit.create({ data: { id: "unit", code: "U", title: "U", departmentId: "d", semester: 1, hoursPerWeek: 1, venueTypeRequired: "ROOM" } });
        await db.teaching.create({ data: { id: "t", unitId: "unit", lecturerId: "l", groupId: "g", expectedSize: 45, sessionsPerWeek: 1, sessionLength: 1 } });
        await db.venue.create({ data: { id: "r", code: "R", type: "ROOM", capacity: 50 } });
        await db.timetableVersion.create({ data: { id: "v", semester: 1, createdBy: "u" } });
        await db.timetableEntry.create({ data: { id: "e", versionId: "v", teachingId: "t", venueId: "r", day: "MON", start: "09:00", end: "10:00" } });
        await db.$executeRawUnsafe(`INSERT INTO AttendanceSession(id,entryId,openedBy,opensAt,closesAt,scanFrom,updatedAt) VALUES('legacy','e','u',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
        await db.$executeRawUnsafe(`INSERT INTO AttendanceRecord(id,sessionId,studentId,deviceId) VALUES('mark','legacy','u','synthetic-device')`);
        const tables = await db.$queryRawUnsafe<Array<{
            name: string;
        }>>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name");
        const original = new Map<string, Record<string, unknown>[]>();
        for (const { name } of tables)
            original.set(name, await db.$queryRawUnsafe(`SELECT * FROM "${name}" ORDER BY rowid`));
        await db.$disconnect();
        names.filter(n => n.includes("_m7_")).forEach(copy);
        deploy();
        for (const [name, old] of original) {
            const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}" ORDER BY rowid`);
            expect(rows).toHaveLength(old.length);
            old.forEach((row, i) => Object.entries(row).forEach(([k, v]) => expect(rows[i][k]).toEqual(v)));
        }
        expect(await db.attendanceSession.findUnique({ where: { id: "legacy" } })).toMatchObject({ originalDate: null, actualDate: null, versionId: null });
        await expect(db.timetableEntry.delete({ where: { id: "e" } })).rejects.toThrow();
        await expect(db.attendanceSession.delete({ where: { id: "legacy" } })).rejects.toThrow();
        expect(await db.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]);
    }
    finally {
        await db.$disconnect();
        rmSync(dir, { recursive: true, force: true });
    }
}, 60000);
