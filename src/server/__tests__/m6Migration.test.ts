/** Additive upgrade replay in disposable SQLite, using the existing Prisma runtime only. */
import { mkdtempSync, readdirSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const root = path.resolve("prisma/migrations");
async function execute(db: PrismaClient, sql: string) {
    for (const statement of sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
        if (/^PRAGMA/i.test(statement))
            await db.$queryRawUnsafe(statement);
        else
            await db.$executeRawUnsafe(statement);
    }
}
const fixture = `
INSERT INTO Department(id,name,schoolId,updatedAt) VALUES('d','D','S',CURRENT_TIMESTAMP);
INSERT INTO User(id,name,email,passwordHash,role,updatedAt) VALUES('o','O','o@test','x','OFFICER',CURRENT_TIMESTAMP);
INSERT INTO Lecturer(id,userId,departmentId,updatedAt) VALUES('l','o','d',CURRENT_TIMESTAMP);
INSERT INTO StudentGroup(id,name,size,departmentId,updatedAt) VALUES('g','G',20,'d',CURRENT_TIMESTAMP);
INSERT INTO Unit(id,code,title,departmentId,semester,hoursPerWeek,venueTypeRequired,updatedAt) VALUES('u','U','Unit','d',1,1,'ROOM',CURRENT_TIMESTAMP);
INSERT INTO Teaching(id,unitId,lecturerId,groupId,expectedSize,sessionsPerWeek,sessionLength,updatedAt) VALUES('t','u','l','g',20,1,1,CURRENT_TIMESTAMP);
INSERT INTO Venue(id,code,type,capacity,updatedAt) VALUES('r','R','ROOM',30,CURRENT_TIMESTAMP);
INSERT INTO TimetableVersion(id,semester,status,createdBy,publishedAt,updatedAt) VALUES('v',1,'PUBLISHED','o',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO TimetableEntry(id,versionId,teachingId,venueId,day,start,end,updatedAt) VALUES('e','v','t','r','MON','09:00','10:00',CURRENT_TIMESTAMP);
INSERT INTO RescheduleRequest(id,entryId,proposedDay,proposedStart,proposedEnd,reason,updatedAt) VALUES('req','e','TUE','11:00','12:00','Legacy request',CURRENT_TIMESTAMP);
INSERT INTO LecturerAvailability(id,lecturerId,day,start,end,available,updatedAt) VALUES('la','l','FRI','15:00','16:00',0,CURRENT_TIMESTAMP);
INSERT INTO VenueUnavailable(id,venueId,day,start,end,reason,updatedAt) VALUES('vu','r','FRI','14:00','15:00','Synthetic closure',CURRENT_TIMESTAMP);
INSERT INTO Submission(id,departmentId,semester,status,updatedAt) VALUES('sub','d',1,'APPROVED',CURRENT_TIMESTAMP);
INSERT INTO Issue(id,departmentId,venueId,reportedBy,text,updatedAt) VALUES('issue','d','r','o','Synthetic legacy issue',CURRENT_TIMESTAMP);
INSERT INTO AuditLog(id,actorId,action,entity,entityId,reason) VALUES('audit','o','LEGACY_FIXTURE','TimetableVersion','v','Synthetic history');
INSERT INTO AssumptionFeedback(id,assumptionKey,verdict,note) VALUES('feedback','A1','CONFIRM','Synthetic retained feedback');
INSERT INTO User(id,name,email,passwordHash,role,departmentId,studentGroupId,updatedAt) VALUES('student','Student','student@test','x','STUDENT','d','g',CURRENT_TIMESTAMP);
INSERT INTO AttendanceSession(id,entryId,openedBy,opensAt,closesAt,scanFrom,updatedAt) VALUES('session','e','o',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO AttendanceRecord(id,sessionId,studentId) VALUES('record','session','student');

`;
let dir: string, db: PrismaClient, fresh: PrismaClient, duplicate: PrismaClient;
let upgradeSchema: string, duplicateSchema: string, duplicateUrl: string;
function deploy(schema: string, url: string) { execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", schema], { env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info" }, stdio: "pipe", timeout: 60000 }); }
function copyMigrations(target: string, includeM6: boolean) {
    const migrationDir = path.join(target, "migrations");
    mkdirSync(migrationDir, { recursive: true });
    copyFileSync(path.resolve("prisma/schema.prisma"), path.join(target, "schema.prisma"));
    copyFileSync(path.join(root, "migration_lock.toml"), path.join(migrationDir, "migration_lock.toml"));
    for (const name of readdirSync(root).filter(n => n !== "migration_lock.toml" && !n.includes("_m7_") && (includeM6 || !n.includes("20261108160000")))) {
        mkdirSync(path.join(migrationDir, name), { recursive: true });
        copyFileSync(path.join(root, name, "migration.sql"), path.join(migrationDir, name, "migration.sql"));
    }
    return path.join(target, "schema.prisma");
}
const original = new Map<string, Record<string, unknown>[]>();
const tables = ["Department", "User", "Lecturer", "StudentGroup", "Unit", "Teaching", "Venue", "TimetableVersion", "TimetableEntry", "RescheduleRequest", "LecturerAvailability", "VenueUnavailable", "Submission", "Issue", "AuditLog", "AssumptionFeedback", "AttendanceSession", "AttendanceRecord"];
describe("M6 additive SQLite migration", () => {
    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), "tams-m6-upgrade-"));
        const upgradeUrl = `file:${path.join(dir, "upgrade.db")}`, freshUrl = `file:${path.join(dir, "fresh.db")}`;
        duplicateUrl = `file:${path.join(dir, "duplicate.db")}`;
        upgradeSchema = copyMigrations(path.join(dir, "upgrade"), false);
        duplicateSchema = copyMigrations(path.join(dir, "duplicate"), false);
        deploy(upgradeSchema, upgradeUrl);
        deploy(duplicateSchema, duplicateUrl);
        db = new PrismaClient({ datasources: { db: { url: upgradeUrl } } });
        duplicate = new PrismaClient({ datasources: { db: { url: duplicateUrl } } });
        await execute(db, fixture);
        await execute(duplicate, fixture);
        for (const table of tables)
            original.set(table, await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`));
        await db.$disconnect();
        copyMigrations(path.join(dir, "upgrade"), true);
        deploy(upgradeSchema, upgradeUrl);
        db = new PrismaClient({ datasources: { db: { url: upgradeUrl } } });
        deploy(path.resolve("prisma/schema.prisma"), freshUrl);
        fresh = new PrismaClient({ datasources: { db: { url: freshUrl } } });
    }, 60000);
    afterAll(async () => { await Promise.all([db?.$disconnect(), fresh?.$disconnect(), duplicate?.$disconnect()]); if (dir)
        rmSync(dir, { recursive: true, force: true }); });
    it("preserves every original field and row", async () => { for (const table of tables) {
        const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`);
        const old = original.get(table)!;
        expect(rows).toHaveLength(old.length);
        for (let i = 0; i < old.length; i++)
            for (const [key, val] of Object.entries(old[i]))
                expect(rows[i][key]).toEqual(val);
    } });
    it("backfills legacy pending claims and WEEKLY default", async () => expect(await db.rescheduleRequest.findUnique({ where: { id: "req" } })).toMatchObject({ kind: "WEEKLY", pendingKey: "e", originalDate: null, resultDraftVersionId: null }));
    it("database enforces pending uniqueness across kinds", async () => { await expect(db.rescheduleRequest.create({ data: { entryId: "e", pendingKey: "e", kind: "ONE_OFF", proposedDay: "TUE", proposedStart: "11:00", proposedEnd: "12:00", reason: "Duplicate claim" } })).rejects.toThrow(); });
    it("result draft reference is a real foreign key", async () => { await expect(db.rescheduleRequest.update({ where: { id: "req" }, data: { resultDraftVersionId: "missing" } })).rejects.toThrow(); });
    it("foreign key integrity survives upgrade", async () => expect(await db.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]));
    it("all migrations deploy from an empty database", async () => expect(await fresh.timetableOccurrenceException.count()).toBe(0));
    it("duplicate historical pending rows abort without erasing requests", async () => { await duplicate.$executeRawUnsafe("INSERT INTO RescheduleRequest(id,entryId,proposedDay,proposedStart,proposedEnd,reason,updatedAt) VALUES('duplicate','e','TUE','10:00','11:00','Legacy duplicate',CURRENT_TIMESTAMP)"); await duplicate.$disconnect(); copyMigrations(path.join(dir, "duplicate"), true); expect(() => deploy(duplicateSchema, duplicateUrl)).toThrow(); duplicate = new PrismaClient({ datasources: { db: { url: duplicateUrl } } }); const rows = await duplicate.$queryRawUnsafe<Array<{
        n: bigint;
    }>>("SELECT COUNT(*) AS n FROM RescheduleRequest"); expect(Number(rows[0].n)).toBe(2); }, 30000);
});
