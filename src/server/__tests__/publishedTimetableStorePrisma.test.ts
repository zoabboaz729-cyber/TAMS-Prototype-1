/**
 * M4-T4b — isolated-database integration tests for the Prisma published-timetable
 * read adapter. Every suite runs against a fresh SQLite file inside a uniquely
 * mkdtemp-created directory under os.tmpdir() (schema pushed with `prisma db push`
 * pointed at that exact disposable path, removed in afterAll). The protected
 * prisma/dev.db and prisma/walkthrough.db are never opened, copied or reset. The
 * suites exercise real Prisma reads, the real readPublishedTimetable() service
 * against the real adapter, and real transaction currency re-checks. Failures are
 * injected only in the test layer (a Proxy over the isolated client), never in
 * production code. Stale rejection is proven as a SEQUENTIAL committed
 * intervention between the service's version lookup and its transactional entry
 * read — including one committed on a genuinely separate second connection — not
 * a simultaneous-writer race, which SQLite's single-writer serialization cannot
 * reliably force here without unsafe locking (DECISIONS.md M4-T4b).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { seedDepartments, seedLecturerAvailabilities, seedLecturers, seedStudentGroups, seedTeachings,
  seedTimetableEntries, seedTimetableVersions, seedUnits, seedUsers, seedVenueUnavailabilities, seedVenues } from "@/domain/seedData";
import { readPublishedTimetable } from "@/server/publishedTimetable";
import type { PublishedTimetableResult, PublishedTimetableStore } from "@/server/publishedTimetableContract";
import { createPublishedTimetableStore } from "@/server/publishedTimetableStorePrisma";

// --- exclusive disposable database (M4-T4-P0 rules 5-9) --------------------

type TempDb = { client: PrismaClient; dir: string; filePath: string; url: string };

/** mkdtemp creates the directory exclusively (it fails if the name exists), so a
 *  fresh path inside it cannot collide with user data; the existence guard aborts
 *  rather than overwrites, and db push targets this exact injected url. */
function makeTempDb(prefix: string): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tams-${prefix}-`));
  const filePath = path.join(dir, "timetable.db");
  if (fs.existsSync(filePath)) throw new Error(`refusing to overwrite existing temp database ${filePath}`);
  const url = `file:${filePath.replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 60000 });
  return { client: new PrismaClient({ datasources: { db: { url } } }), dir, filePath, url };
}

/** Removes only the directory this invocation created, after releasing handles. */
async function disposeTempDb(db: TempDb): Promise<void> {
  await db.client.$disconnect();
  fs.rmSync(db.dir, { recursive: true, force: true });
}

/** Test-layer failure injection, no production hook: `transaction` rejects the
 *  whole read transaction (a lock/transaction failure); `versionList` rejects the
 *  scoped version query with a secret-bearing message to prove nothing leaks. */
function withFailingRead(client: PrismaClient, failOn: "transaction" | "versionList", message: string): PrismaClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (failOn === "transaction" && prop === "$transaction") return () => Promise.reject(new Error(message));
      if (failOn === "versionList" && prop === "timetableVersion") {
        const delegate = Reflect.get(target, prop, receiver) as object;
        return new Proxy(delegate, { get(d, m, r) { return m === "findMany" ? () => Promise.reject(new Error(message)) : Reflect.get(d, m, r); } });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

/** A sequential committed intervention: the competing write lands after the
 *  service's version lookup and before the transactional entry read re-check. */
function withInterventionBeforeRead(store: PublishedTimetableStore, intervene: () => Promise<unknown>): PublishedTimetableStore {
  return { ...store, readPublishedEntries: async (versionId, semester) => { await intervene(); return store.readPublishedEntries(versionId, semester); } };
}

function okEntries(result: PublishedTimetableResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result;
}

// ---------------------------------------------------------------------------
// Controlled fixture: scoped reads, projection and transactional currency
// ---------------------------------------------------------------------------

const OFFICER = "user-officer";
const officer: Actor = { id: OFFICER, role: "OFFICER", departmentId: null, studentGroupId: null };
const PUB = "ver-pub-s1";
const PUB_AT = new Date("2026-01-05T08:00:00.000Z");
const NOW = new Date("2026-03-01T09:00:00.000Z");

const DEPARTMENTS = [{ id: "dept-f", name: "F", schoolId: "S" }];
const USERS = [{ id: OFFICER, name: "Officer", email: "o@pub.test", passwordHash: "x", role: "OFFICER" },
  { id: "user-lect-f", name: "Lecturer F", email: "lf@pub.test", passwordHash: "x", role: "LECTURER", departmentId: "dept-f" },
  { id: "user-lect-g", name: "Lecturer G", email: "lg@pub.test", passwordHash: "x", role: "LECTURER", departmentId: "dept-f" },
  { id: "user-student", name: "Student S", email: "s@pub.test", passwordHash: "x", role: "STUDENT", departmentId: "dept-f", studentGroupId: "grp-1" }];
const LECTURERS = [{ id: "lect-f", userId: "user-lect-f", departmentId: "dept-f" }, { id: "lect-g", userId: "user-lect-g", departmentId: "dept-f" }];
const GROUPS = [{ id: "grp-1", name: "G1", size: 40, departmentId: "dept-f" }, { id: "grp-2", name: "G2", size: 30, departmentId: "dept-f" }];
const UNITS = [{ id: "unit-a", code: "A", title: "Unit A", departmentId: "dept-f", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-b", code: "B", title: "Unit B", departmentId: "dept-f", semester: 1, hoursPerWeek: 3, venueTypeRequired: "HALL", scheduled: true }];
const TEACHINGS = [{ id: "teach-1", unitId: "unit-a", lecturerId: "lect-f", groupId: "grp-1", expectedSize: 40, sessionsPerWeek: 1, sessionLength: 1 },
  { id: "teach-2", unitId: "unit-b", lecturerId: "lect-g", groupId: "grp-2", expectedSize: 30, sessionsPerWeek: 1, sessionLength: 2 },
  { id: "teach-3", unitId: "unit-a", lecturerId: "lect-f", groupId: "grp-2", expectedSize: 30, sessionsPerWeek: 1, sessionLength: 1 }];
const VENUES = [{ id: "venue-room", code: "RM", type: "ROOM", capacity: 50, ownerDepartmentId: "dept-f", facilities: "[]", status: "ACTIVE" },
  { id: "venue-lh", code: "LH", type: "HALL", capacity: 100, ownerDepartmentId: "dept-f", facilities: "[]", status: "ACTIVE" },
  { id: "venue-maint", code: "MT", type: "ROOM", capacity: 60, ownerDepartmentId: "dept-f", facilities: "[]", status: "MAINTENANCE" }];
const VERSIONS = [{ id: PUB, semester: 1, status: "PUBLISHED", createdBy: OFFICER, publishedAt: PUB_AT },
  { id: "ver-pub-s2", semester: 2, status: "PUBLISHED", createdBy: OFFICER, publishedAt: new Date("2026-01-06T08:00:00.000Z") },
  { id: "ver-draft", semester: 1, status: "DRAFT", createdBy: OFFICER, publishedAt: null },
  { id: "ver-arch", semester: 1, status: "ARCHIVED", createdBy: OFFICER, publishedAt: new Date("2025-12-01T08:00:00.000Z") }];
const ENTRIES = [{ id: "e-1", versionId: PUB, teachingId: "teach-1", venueId: "venue-room", day: "MON", start: "08:00", end: "09:00", locked: false },
  { id: "e-2", versionId: PUB, teachingId: "teach-2", venueId: "venue-lh", day: "TUE", start: "08:00", end: "10:00", locked: false },
  { id: "e-3", versionId: PUB, teachingId: "teach-3", venueId: "venue-maint", day: "MON", start: "08:00", end: "09:00", locked: false },
  { id: "e-s2", versionId: "ver-pub-s2", teachingId: "teach-2", venueId: "venue-lh", day: "THU", start: "09:00", end: "10:00", locked: false },
  { id: "e-draft", versionId: "ver-draft", teachingId: "teach-1", venueId: "venue-room", day: "FRI", start: "10:00", end: "11:00", locked: false },
  { id: "e-arch", versionId: "ver-arch", teachingId: "teach-1", venueId: "venue-room", day: "WED", start: "10:00", end: "11:00", locked: false }];

describe("publishedTimetableStorePrisma reads and atomic currency re-check", () => {
  let db: TempDb;
  let store: PublishedTimetableStore;

  /** Children first on delete, parents first on insert (a student user links a
   *  group, so users are removed before groups and groups created before users). */
  async function seedFixture(): Promise<void> {
    const c = db.client;
    await c.timetableEntry.deleteMany({}); await c.timetableVersion.deleteMany({}); await c.venue.deleteMany({});
    await c.teaching.deleteMany({}); await c.unit.deleteMany({}); await c.lecturer.deleteMany({});
    await c.user.deleteMany({}); await c.studentGroup.deleteMany({}); await c.department.deleteMany({});
    await c.department.createMany({ data: DEPARTMENTS }); await c.studentGroup.createMany({ data: GROUPS });
    await c.user.createMany({ data: USERS }); await c.lecturer.createMany({ data: LECTURERS });
    await c.unit.createMany({ data: UNITS }); await c.teaching.createMany({ data: TEACHINGS });
    await c.venue.createMany({ data: VENUES }); await c.timetableVersion.createMany({ data: VERSIONS });
    await c.timetableEntry.createMany({ data: ENTRIES });
  }

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = makeTempDb("pubread");
    await seedFixture();
    store = createPublishedTimetableStore(db.client);
  }, 60000);
  afterAll(async () => { vi.restoreAllMocks(); await disposeTempDb(db); });
  afterEach(seedFixture);

  const read = (actor: Actor | null, request: unknown, s: PublishedTimetableStore = store) => readPublishedTimetable(s, actor, request);
  async function entriesOf(versionId: string, semester: number) {
    const r = await store.readPublishedEntries(versionId, semester);
    if (r.status !== "current") throw new Error(`expected current, got ${r.status}`);
    return r;
  }

  // --- 1-6: scoped version lookup -----------------------------------------
  it("1-3: lists only the semester's PUBLISHED versions with correct metadata, excluding draft and archived", async () => {
    expect(await store.listPublishedVersionsBySemester(1)).toEqual([{ id: PUB, semester: 1, status: "PUBLISHED", publishedAt: PUB_AT }]);
    expect(await store.listPublishedVersionsBySemester(2)).toEqual([{ id: "ver-pub-s2", semester: 2, status: "PUBLISHED", publishedAt: new Date("2026-01-06T08:00:00.000Z") }]);
    expect(await store.listPublishedVersionsBySemester(3)).toEqual([]);
  });
  it("4,6: returns every published version of a semester in deterministic id order, never a winner", async () => {
    await db.client.timetableVersion.create({ data: { id: "ver-pub-s1b", semester: 1, status: "PUBLISHED", createdBy: OFFICER, publishedAt: new Date("2026-01-04T08:00:00.000Z") } });
    const rows = await store.listPublishedVersionsBySemester(1);
    expect(rows.map((r) => r.id)).toEqual([PUB, "ver-pub-s1b"]);
    expect(rows).toEqual(await store.listPublishedVersionsBySemester(1));
  });
  it("5: preserves a null publication timestamp instead of guessing one", async () => {
    await db.client.timetableVersion.update({ where: { id: "ver-pub-s2" }, data: { publishedAt: null } });
    expect(await store.listPublishedVersionsBySemester(2)).toEqual([{ id: "ver-pub-s2", semester: 2, status: "PUBLISHED", publishedAt: null }]);
  });

  // --- 7-12: selector lookups ---------------------------------------------
  it("7,12: lists stored group ids and names in deterministic id order", async () => {
    expect(await store.listStudentGroups()).toEqual([{ id: "grp-1", name: "G1", departmentId: "dept-f" }, { id: "grp-2", name: "G2", departmentId: "dept-f" }]);
    expect(await store.listStudentGroups()).toEqual(await store.listStudentGroups());
  });
  it("8,12: joins lecturer display names from the linked User, ordered by lecturer id", async () => {
    expect(await store.listLecturers()).toEqual([{ id: "lect-f", userId: "user-lect-f", displayName: "Lecturer F" }, { id: "lect-g", userId: "user-lect-g", displayName: "Lecturer G" }]);
    expect(await store.listLecturers()).toEqual(await store.listLecturers());
  });
  it("9,10: resolves lecturer identity by the real userId relation, null when absent (never by role)", async () => {
    expect(await store.findLecturerByUserId("user-lect-f")).toEqual({ id: "lect-f", userId: "user-lect-f", displayName: "Lecturer F" });
    expect(await store.findLecturerByUserId("user-officer")).toBeNull();
    expect(await store.findLecturerByUserId("user-ghost")).toBeNull();
  });
  it("11,12: lists venue ids and codes including a maintenance venue, ordered by id", async () => {
    expect(await store.listVenues()).toEqual([{ id: "venue-lh", code: "LH" }, { id: "venue-maint", code: "MT" }, { id: "venue-room", code: "RM" }]);
    expect(await store.listVenues()).toEqual(await store.listVenues());
  });

  // --- 13-23: entry projection --------------------------------------------
  it("13-17,19,22: projects the requested version's entries with real joins, deterministically", async () => {
    const r = await entriesOf(PUB, 1);
    expect(r.version).toEqual({ id: PUB, semester: 1, status: "PUBLISHED", publishedAt: PUB_AT });
    expect(r.entries.map((e) => e.id)).toEqual(["e-1", "e-3", "e-2"]);
    expect(r.entries.every((e) => e.versionId === PUB)).toBe(true);
    expect(r.entries[0]).toEqual({ id: "e-1", versionId: PUB, teachingId: "teach-1", venueId: "venue-room", day: "MON", start: "08:00", end: "09:00",
      unitCode: "A", unitTitle: "Unit A", groupId: "grp-1", groupName: "G1", lecturerId: "lect-f", lecturerName: "Lecturer F", venueCode: "RM" });
    expect(r.entries).toEqual((await entriesOf(PUB, 1)).entries);
  });
  it("18,20: preserves a multi-hour session and keeps same-time different-group entries separate", async () => {
    const r = await entriesOf(PUB, 1);
    const e2 = r.entries.find((e) => e.id === "e-2")!;
    expect([e2.day, e2.start, e2.end]).toEqual(["TUE", "08:00", "10:00"]);
    expect([e2.unitCode, e2.unitTitle, e2.groupId, e2.groupName, e2.lecturerId, e2.lecturerName, e2.venueCode]).toEqual(["B", "Unit B", "grp-2", "G2", "lect-g", "Lecturer G", "LH"]);
    const e3 = r.entries.find((e) => e.id === "e-3")!;
    expect([e3.day, e3.start, e3.groupId, e3.groupName]).toEqual(["MON", "08:00", "grp-2", "G2"]);
    expect(r.entries.filter((e) => e.day === "MON" && e.start === "08:00").map((e) => e.id)).toEqual(["e-1", "e-3"]);
  });
  it("21: an existing published version with zero entries returns current with an empty list", async () => {
    await db.client.timetableVersion.update({ where: { id: PUB }, data: { status: "ARCHIVED" } });
    await db.client.timetableVersion.create({ data: { id: "ver-empty", semester: 1, status: "PUBLISHED", createdBy: OFFICER, publishedAt: NOW } });
    const r = await entriesOf("ver-empty", 1);
    expect(r.version.id).toBe("ver-empty");
    expect(r.entries).toEqual([]);
  });
  it("23: a venue's operational status change does not remove a referenced published entry", async () => {
    expect((await entriesOf(PUB, 1)).entries.some((e) => e.venueId === "venue-maint" && e.venueCode === "MT")).toBe(true);
    await db.client.venue.update({ where: { id: "venue-room" }, data: { status: "INACTIVE" } });
    expect((await entriesOf(PUB, 1)).entries.some((e) => e.venueId === "venue-room" && e.venueCode === "RM")).toBe(true);
    expect((await store.listVenues()).some((v) => v.id === "venue-room")).toBe(true);
  });

  // --- 24-30: transactional currency --------------------------------------
  it("24: a current published version returns current", async () => {
    expect((await store.readPublishedEntries(PUB, 1)).status).toBe("current");
  });
  it("25: a missing current publication returns stale", async () => {
    expect(await store.readPublishedEntries("ver-ghost", 1)).toEqual({ status: "stale" });
  });
  it("26: the requested version now ARCHIVED returns stale", async () => {
    await db.client.timetableVersion.update({ where: { id: PUB }, data: { status: "ARCHIVED" } });
    expect(await store.readPublishedEntries(PUB, 1)).toEqual({ status: "stale" });
  });
  it("27: another version becoming the sole current publication returns stale", async () => {
    await db.client.timetableVersion.update({ where: { id: PUB }, data: { status: "ARCHIVED" } });
    await db.client.timetableVersion.update({ where: { id: "ver-draft" }, data: { status: "PUBLISHED", publishedAt: NOW } });
    expect(await store.readPublishedEntries(PUB, 1)).toEqual({ status: "stale" });
    expect((await entriesOf("ver-draft", 1)).version.id).toBe("ver-draft");
  });
  it("28: two PUBLISHED versions for one semester return stale", async () => {
    await db.client.timetableVersion.create({ data: { id: "ver-rival", semester: 1, status: "PUBLISHED", createdBy: OFFICER, publishedAt: NOW } });
    expect(await store.readPublishedEntries(PUB, 1)).toEqual({ status: "stale" });
  });
  it("29: a requested semester that does not match the current version returns stale", async () => {
    expect(await store.readPublishedEntries(PUB, 2)).toEqual({ status: "stale" });
  });
  it("30: a PUBLISHED version with no timestamp is refused as current", async () => {
    await db.client.timetableVersion.update({ where: { id: PUB }, data: { publishedAt: null } });
    expect(await store.readPublishedEntries(PUB, 1)).toEqual({ status: "stale" });
  });

  // --- concurrency proof: sequential committed intervention ---------------
  it("reports STALE when a publication commits between resolution and the atomic read (sequential intervention)", async () => {
    const intervene = async () => {
      await db.client.timetableVersion.update({ where: { id: PUB }, data: { status: "ARCHIVED" } });
      await db.client.timetableVersion.update({ where: { id: "ver-draft" }, data: { status: "PUBLISHED", publishedAt: NOW } });
    };
    expect(await read(officer, {}, withInterventionBeforeRead(store, intervene))).toEqual({ ok: false, kind: "STALE", semester: 1 });
  });
  it("observes a competing publication committed on a second connection (sequential, not a simultaneous race)", async () => {
    const second = new PrismaClient({ datasources: { db: { url: db.url } } });
    try {
      const intervene = async () => {
        await second.timetableVersion.update({ where: { id: PUB }, data: { status: "ARCHIVED" } });
        await second.timetableVersion.update({ where: { id: "ver-draft" }, data: { status: "PUBLISHED", publishedAt: NOW } });
      };
      expect(await read(officer, {}, withInterventionBeforeRead(store, intervene))).toEqual({ ok: false, kind: "STALE", semester: 1 });
    } finally { await second.$disconnect(); }
  });

  // --- 40 + failure injection: a failed read is never an empty success -----
  it("40: a read-transaction failure throws and the service returns INTERNAL_ERROR, never an empty timetable", async () => {
    const failing = createPublishedTimetableStore(withFailingRead(db.client, "transaction", "SQLITE_BUSY: database is locked"));
    await expect(failing.readPublishedEntries(PUB, 1)).rejects.toThrow(/locked/i);
    expect(await read(officer, {}, failing)).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });
  it("a query failure leaks no SQL, connection string or secret to the caller or the log", async () => {
    const secret = "postgres://tams:hunter2@db.internal:5432/tams";
    const failing = createPublishedTimetableStore(withFailingRead(db.client, "versionList", `SELECT * FROM TimetableVersion; ${secret}`));
    const spy = vi.spyOn(console, "error");
    spy.mockClear();
    const result = await read(officer, {}, failing);
    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toMatch(/SELECT|hunter2|db\.internal|sqlite|prisma/i);
    expect(spy.mock.calls).toEqual([["[publishedTimetable] read failed; returning INTERNAL_ERROR"]]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// Seeded database: the real service plus this adapter on the synthetic fixture
// ---------------------------------------------------------------------------

const CLEAN_SEED = seedTimetableEntries.filter((e) => e.id.startsWith("entry-clean-"));
const copyEntries = (versionId: string, prefix: string) => CLEAN_SEED.map((e, i) => ({
  id: `${prefix}-${i}`, versionId, teachingId: e.teachingId, venueId: e.venueId, day: e.day, start: e.start, end: e.end, locked: false }));
const SEED_PUB = "ver-seed-pub";
const SEED_PUB_AT = new Date("2026-02-01T08:00:00.000Z");
const SEED_NOW = new Date("2026-03-02T10:00:00.000Z");

describe("publishedTimetableStorePrisma seeded service integration (real adapter)", () => {
  let db: TempDb;
  let store: PublishedTimetableStore;
  const student: Actor = { id: "user-student-1", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" };
  const lecturerB: Actor = { id: "user-lecturer-b", role: "LECTURER", departmentId: "dept-computing", studentGroupId: null };
  const seedOfficer: Actor = { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null };

  /** Resets only the controlled published/archived versions, leaving the seed's
   *  base tables and its DRAFT ver-s1-planted untouched. */
  async function resetPublished(): Promise<void> {
    const c = db.client;
    const ids = [SEED_PUB, "ver-seed-new", "ver-seed-rival", "ver-seed-arch"];
    await c.timetableEntry.deleteMany({ where: { versionId: { in: ids } } });
    await c.timetableVersion.deleteMany({ where: { id: { in: ids } } });
    await c.timetableVersion.createMany({ data: [
      { id: SEED_PUB, semester: 1, status: "PUBLISHED", createdBy: "user-officer", publishedAt: SEED_PUB_AT },
      { id: "ver-seed-arch", semester: 1, status: "ARCHIVED", createdBy: "user-officer", publishedAt: new Date("2025-12-01T08:00:00.000Z") }] });
    await c.timetableEntry.createMany({ data: [...copyEntries(SEED_PUB, "copy-pub"), ...copyEntries("ver-seed-arch", "copy-arch")] });
  }

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db = makeTempDb("pubseedread");
    const c = db.client;
    for (const row of seedDepartments) await c.department.create({ data: row });
    for (const row of seedStudentGroups) await c.studentGroup.create({ data: row });
    for (const { id, name, email, role, departmentId, studentGroupId } of seedUsers) await c.user.create({ data: { id, name, email, role, departmentId, studentGroupId, passwordHash: "seed-placeholder" } });
    for (const row of seedLecturers) await c.lecturer.create({ data: row });
    for (const row of seedUnits) await c.unit.create({ data: row });
    for (const row of seedTeachings) await c.teaching.create({ data: row });
    for (const { facilities, ...row } of seedVenues) await c.venue.create({ data: { ...row, facilities: JSON.stringify(facilities) } });
    for (const row of seedVenueUnavailabilities) await c.venueUnavailable.create({ data: row });
    for (const row of seedLecturerAvailabilities) await c.lecturerAvailability.create({ data: row });
    for (const row of seedTimetableVersions) await c.timetableVersion.create({ data: row });
    for (const row of seedTimetableEntries) await c.timetableEntry.create({ data: row });
    expect(CLEAN_SEED).toHaveLength(6);
    await resetPublished();
    store = createPublishedTimetableStore(db.client);
  }, 120000);
  afterAll(async () => { vi.restoreAllMocks(); await disposeTempDb(db); });
  afterEach(resetPublished);

  const read = (actor: Actor | null, request: unknown, s: PublishedTimetableStore = store) => readPublishedTimetable(s, actor, request);

  it("31: an authorized student gets their own group's entries by default", async () => {
    const r = okEntries(await read(student, {}));
    expect([r.view, r.selectionId]).toEqual(["group", "group-SE-Y4"]);
    expect(r.entries.every((e) => e.groupId === "group-SE-Y4")).toBe(true);
    expect(r.entries.map((e) => e.id).sort()).toEqual(["copy-pub-0", "copy-pub-1", "copy-pub-2"]);
  });
  it("32: an authorized lecturer gets their own teaching entries by default", async () => {
    const r = okEntries(await read(lecturerB, {}));
    expect([r.view, r.selectionId]).toEqual(["lecturer", "lecturer-B"]);
    expect(r.entries.map((e) => e.id)).toEqual(["copy-pub-0"]);
    expect(r.entries.every((e) => e.lecturerId === "lecturer-B")).toBe(true);
  });
  it("33: an officer gets the deterministic first group default", async () => {
    const r = okEntries(await read(seedOfficer, {}));
    expect([r.view, r.selectionId]).toEqual(["group", "group-CS-Y2"]);
    expect(r.entries.every((e) => e.groupId === "group-CS-Y2")).toBe(true);
    expect(r.entries.map((e) => e.id).sort()).toEqual(["copy-pub-3", "copy-pub-4"]);
  });
  it("34: an explicit venue selection returns only entries using that venue", async () => {
    const r = okEntries(await read(seedOfficer, { view: "venue", id: "venue-CR1" }));
    expect(r.entries.every((e) => e.venueId === "venue-CR1")).toBe(true);
    expect(r.entries.map((e) => e.id).sort()).toEqual(["copy-pub-0", "copy-pub-1", "copy-pub-3"]);
  });
  it("35: an explicit existing selection with zero matching entries succeeds empty", async () => {
    const r = okEntries(await read(seedOfficer, { view: "venue", id: "venue-LAB1" }));
    expect(r.selectionId).toBe("venue-LAB1");
    expect(r.entries).toEqual([]);
  });
  it("36: no current publication for the semester returns NO_PUBLISHED_VERSION", async () => {
    expect(await read(seedOfficer, { semester: 2 })).toEqual({ ok: false, kind: "NO_PUBLISHED_VERSION", semester: 2 });
  });
  it("37: multiple published versions return AMBIGUOUS_PUBLISHED_VERSION", async () => {
    await db.client.timetableVersion.create({ data: { id: "ver-seed-rival", semester: 1, status: "PUBLISHED", createdBy: "user-officer", publishedAt: SEED_NOW } });
    expect(await read(seedOfficer, {})).toEqual({ ok: false, kind: "AMBIGUOUS_PUBLISHED_VERSION", semester: 1 });
  });
  it("38,39: a newly published version replaces the previous current one and archived entries stay unchanged", async () => {
    const archivedBefore = await db.client.timetableEntry.findMany({ where: { versionId: SEED_PUB }, orderBy: { id: "asc" } });
    await db.client.timetableVersion.update({ where: { id: SEED_PUB }, data: { status: "ARCHIVED" } });
    await db.client.timetableVersion.create({ data: { id: "ver-seed-new", semester: 1, status: "PUBLISHED", createdBy: "user-officer", publishedAt: SEED_NOW } });
    await db.client.timetableEntry.createMany({ data: copyEntries("ver-seed-new", "copy-new") });
    const r = okEntries(await read(student, {}));
    expect(r.version.id).toBe("ver-seed-new");
    expect(r.entries.map((e) => e.id).sort()).toEqual(["copy-new-0", "copy-new-1", "copy-new-2"]);
    expect((await db.client.timetableVersion.findUnique({ where: { id: SEED_PUB } }))!.status).toBe("ARCHIVED");
    expect(await db.client.timetableEntry.findMany({ where: { versionId: SEED_PUB }, orderBy: { id: "asc" } })).toEqual(archivedBefore);
  });
  it("40: a query failure does not become a successful empty timetable", async () => {
    const failing = createPublishedTimetableStore(withFailingRead(db.client, "transaction", "SQLITE_BUSY: database is locked"));
    expect(await read(student, {}, failing)).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });
});