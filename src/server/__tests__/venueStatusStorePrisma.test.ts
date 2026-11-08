/** Real SQLite fixture only: no dev/walkthrough database is opened. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDepartments, seedStudentGroups, seedUsers, seedLecturers, seedUnits, seedTeachings, seedVenues } from "@/domain/seedData";
import { USER_ROLES } from "@/domain/types";
import type { Actor } from "@/domain/permissions";
import { createVenueStatusStore } from "../venueStatusStorePrisma";
import { readVenueStatus } from "../venueStatus";
import { VenueStatusSnapshotSchema } from "../venueStatusContract";
let dir: string | undefined, db: PrismaClient;
const instant = () => new Date("2026-11-09T05:30:00Z");
const q = { mode: "demo", day: "MON", time: "08:30" };
const actor = (role: Actor["role"] = "OFFICER"): Actor => ({ id: "user-officer", role, departmentId: null, studentGroupId: null });
const v = seedVenues[0].id;
const t1 = seedTeachings.find((t) => seedUnits.find((u) => u.id === t.unitId)?.semester === 1)!.id;
const t2 = seedTeachings.find((t) => seedUnits.find((u) => u.id === t.unitId)?.semester === 2)!.id;
async function reset() {
  await db.timetableEntry.deleteMany(); await db.timetableVersion.deleteMany(); await db.venueUnavailable.deleteMany();
  await db.venue.updateMany({ data: { status: "ACTIVE" } });
  await db.timetableVersion.createMany({ data: [
    { id: "pub1", semester: 1, status: "PUBLISHED", publishedAt: new Date("2026-01-01T00:00:00Z"), createdBy: "user-officer" },
    { id: "pub2", semester: 2, status: "PUBLISHED", publishedAt: new Date("2026-01-02T00:00:00Z"), createdBy: "user-officer" },
    { id: "draft", semester: 1, status: "DRAFT", createdBy: "user-officer" },
    { id: "arch", semester: 1, status: "ARCHIVED", publishedAt: new Date("2025-01-01T00:00:00Z"), createdBy: "user-officer" },
  ] });
  await db.timetableEntry.createMany({ data: [
    { id: "e1", versionId: "pub1", teachingId: t1, venueId: v, day: "MON", start: "08:00", end: "09:00" },
    { id: "e2", versionId: "pub2", teachingId: t2, venueId: v, day: "MON", start: "10:00", end: "11:00" },
    { id: "ed", versionId: "draft", teachingId: t1, venueId: v, day: "MON", start: "08:00", end: "17:00" },
    { id: "ea", versionId: "arch", teachingId: t1, venueId: v, day: "MON", start: "08:00", end: "17:00" },
  ] });
}
const read = (input: unknown = q, role: Actor["role"] = "OFFICER") => readVenueStatus(actor(role), input, createVenueStatusStore(db), instant);
function success(r: Awaited<ReturnType<typeof read>>) { if (!r.ok) throw new Error(JSON.stringify(r)); return r; }
function row(r: Awaited<ReturnType<typeof read>>) { return success(r).rows.find((r) => r.code === seedVenues[0].code)!; }
async function snapshot() {
  const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`;
  const data = [];
  for (const { name } of tables) {
    // Test-only identifier from sqlite_master, quoted; all persisted tables compared.
    data.push([name, await db.$queryRawUnsafe(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)]);
  }
  return JSON.stringify(data, (_, x) => typeof x === "bigint" ? x.toString() : x);
}
describe("M5-T2b real isolated SQLite snapshot", () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "tams-m5-status-"));
    const url = `file:${path.join(dir, "fixture.db")}`;
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 60000,
    });
    // Prisma errors are handled by the service; never emit stored exception text.
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    for (const x of seedDepartments) await db.department.create({ data: x });
    for (const x of seedStudentGroups) await db.studentGroup.create({ data: x });
    for (const { id, name, email, role, departmentId, studentGroupId } of seedUsers)
      await db.user.create({ data: { id, name, email, role, departmentId, studentGroupId, passwordHash: "synthetic-test" } });
    for (const x of seedLecturers) await db.lecturer.create({ data: x });
    for (const x of seedUnits) await db.unit.create({ data: x });
    for (const x of seedTeachings) await db.teaching.create({ data: x });
    for (const { facilities, ...x } of seedVenues) await db.venue.create({ data: { ...x, facilities: JSON.stringify(facilities) } });
  }, 120000);
  beforeEach(reset);
  afterAll(async () => { if (db) await db.$disconnect(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  it("reads only unique current publication for the requested semester", async () => {
    expect(row(await read()).status).toBe("OCCUPIED");
    expect(row(await read({ ...q, semester: "2" })).status).toBe("FREE");
    const s = VenueStatusSnapshotSchema.parse(await createVenueStatusStore(db).readSnapshot(1));
    expect(s.versions.map((p) => p.id)).toEqual(["pub1"]); expect(s.entries).toHaveLength(1); expect(s.entries[0].versionId).toBe("pub1");
    expect(JSON.stringify(s)).not.toMatch(/teachingId|password|reason|lecturerName|groupId/);
  });
  it("reads operational status and closure with no mutation", async () => {
    await db.venue.update({ where: { id: seedVenues[1].id }, data: { status: "MAINTENANCE" } });
    await db.venue.update({ where: { id: seedVenues[2].id }, data: { status: "INACTIVE" } });
    await db.venueUnavailable.create({ data: { id: "closure", venueId: v, day: "MON", start: "08:00", end: "10:00", reason: "PRIVATE REASON" } });
    const before = await snapshot(), result = success(await read());
    expect(result.rows.filter((r) => r.status === "UNAVAILABLE")).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("PRIVATE REASON"); expect(await snapshot()).toBe(before);
  });
  it("replacement publication refreshes board and preserves archived schedules", async () => {
    const old = await db.timetableEntry.findMany({ where: { versionId: "pub1" } });
    await db.$transaction([
      db.timetableVersion.update({ where: { id: "pub1" }, data: { status: "ARCHIVED" } }),
      db.timetableVersion.update({ where: { id: "draft" }, data: { status: "PUBLISHED", publishedAt: new Date() } }),
    ]);
    expect(success(await read()).publication.id).toBe("draft"); expect(row(await read()).nextFreeAt?.time).toBe("17:00");
    expect(await db.timetableEntry.findMany({ where: { versionId: "pub1" } })).toEqual(old);
  });
  it("only draft/archive means no publication", async () => {
    await db.timetableVersion.updateMany({ where: { status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    expect(await read()).toMatchObject({ kind: "NO_PUBLISHED_VERSION" });
  });
  it("two publications fail closed", async () => {
    await db.timetableVersion.update({ where: { id: "draft" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    expect(await read()).toMatchObject({ kind: "AMBIGUOUS_PUBLISHED_VERSION" });
  });
  it("null publication timestamp is invalid", async () => {
    await db.timetableVersion.update({ where: { id: "pub1" }, data: { publishedAt: null } }); expect(await read()).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
  });
  it("malformed relevant interval and venue state fail closed", async () => {
    await db.timetableEntry.update({ where: { id: "e1" }, data: { start: "bad" } }); expect(await read()).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
    await reset(); await db.venue.update({ where: { id: v }, data: { status: "UNKNOWN" } }); expect(await read()).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
  });
  it("wrong-semester linked teaching is rejected", async () => {
    await db.timetableEntry.update({ where: { id: "e1" }, data: { teachingId: t2 } }); expect(await read()).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
  });
  it.each(["venueId", "teachingId"] as const)("missing %s relationship fails closed, never silently dropped", async (column) => {
    // Deliberate corruption only inside this exclusively created disposable DB.
    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    try {
      await db.$executeRawUnsafe(`UPDATE "TimetableEntry" SET "${column}" = 'missing-link' WHERE id = 'e1'`);
      expect(await read()).toMatchObject({ kind: "INVALID_PUBLISHED_DATA" });
    } finally {
      await db.timetableEntry.deleteMany({ where: { id: "e1" } });
      await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    }
  });
  it.each(USER_ROLES)("%s reads safe live rows without any persisted change", async (role) => {
    const before = await snapshot(), r = success(await read({}, role));
    expect(row(r).status).toBe("OCCUPIED");
    expect(JSON.stringify(r)).not.toMatch(/teaching|lecturer|group|password|unavailabilities|createdBy/);
    expect(await snapshot()).toBe(before);
  });
  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER"] as const)("%s cannot time-travel even with real adapter", async (role) => {
    const s = createVenueStatusStore(db), spy = vi.spyOn(s, "readSnapshot");
    expect(await readVenueStatus(actor(role), q, s, instant)).toMatchObject({ kind: "FORBIDDEN" }); expect(spy).not.toHaveBeenCalled();
  });
  it("repeated clock transitions leave every persisted table byte-equivalent in data", async () => {
    const before = await snapshot();
    for (const [time, status] of [["07:29", "FREE"], ["07:30", "UPCOMING"], ["08:00", "OCCUPIED"], ["09:00", "FREE"]])
      expect(row(await read({ ...q, time })).status).toBe(status);
    expect(await snapshot()).toBe(before);
  });
  it("records measured full-board read duration without an SLA assertion", async () => {
    const start = performance.now();
    for (let i = 0; i < 20; i++) expect(success(await read()).rows).toHaveLength(seedVenues.length);
    console.info(`M5 measurement: ${seedVenues.length} venues, 1 current entry, 20 sequential SQLite full-board reads, ${(performance.now() - start).toFixed(2)} ms; ${process.platform} ${process.arch}, Node ${process.version}. No production load guarantee.`);
  });
});
