/**
 * M4-T3b — isolated-database integration tests for the Prisma publication store. Every test runs against a fresh SQLite file in the OS temp directory (schema pushed with `prisma db push`, deleted in `afterAll`). The working `prisma/dev.db` is never opened. The suite exercises real Prisma reads, the real `performDraftPublish()` service and real transaction behaviour — commits, recomputed fingerprints, conditional updates and rollbacks. Failures are injected only in the test environment (a `$transaction` proxy over the isolated client), never in production code.
 * Stale rejection is proven as a SEQUENTIAL intervention: the competing write is committed before the publication transaction starts, so the in-transaction re-read and recomputed fingerprint are what refuse it. That is not a two-connection race test and is not claimed as one (DECISIONS.md M4-T3b c).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY } from "@/domain/policy";
import { seedDepartments, seedLecturerAvailabilities, seedLecturers, seedStudentGroups, seedTeachings,
  seedTimetableEntries, seedTimetableVersions, seedUnits, seedUsers, seedVenueUnavailabilities, seedVenues } from "@/domain/seedData";
import { performDraftPublish } from "@/server/draftPublish";
import { publishSnapshotFingerprint, type DraftPublishStore, type PublishSnapshot, type PublishTransactionInput } from "@/server/draftPublishContract";
import { createDraftPublishStore } from "@/server/draftPublishStorePrisma";

const OFFICER_ID = "user-officer";
const officer: Actor = { id: OFFICER_ID, role: "OFFICER", departmentId: null, studentGroupId: null };
const CLOCK = new Date("2026-03-01T09:00:00.000Z");
const TARGET = "ver-draft";

function makeTempDb(prefix: string): { client: PrismaClient; filePath: string } {
  const filePath = path.join(os.tmpdir(), `tams-${prefix}-test-${Date.now()}.db`);
  const url = `file:${filePath.replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30000 });
  return { client: new PrismaClient({ datasources: { db: { url } } }), filePath };
}

function disposeTempDb(client: PrismaClient, filePath: string): Promise<unknown> {
  return client.$disconnect().then(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); });
}

/**
 * Failure injection without touching production code: the proxy hands the adapter's own `$transaction` callback a bound `tx` whose write rejects. `audit` fails at the audit insert; `target` fails at the update that stamps the target PUBLISHED — that is the only `updateMany` filtering a single version id by string (the archive updates filter an id list) — so the archive updates that already ran in the same transaction must disappear with it.
 */
function withFailingWrite(client: PrismaClient, stage: "audit" | "target"): PrismaClient {
  return new Proxy(client, {
    get(target_, prop, receiver) {
      if (prop !== "$transaction") return Reflect.get(target_, prop, receiver);
      return (fn: (tx: object) => Promise<unknown>, options?: unknown) => target_.$transaction((tx) => {
        const versions = tx.timetableVersion;
        const patched = stage === "audit"
          ? { auditLog: { create: () => Promise.reject(new Error("injected audit insert failure")) } }
          : { timetableVersion: { findUnique: (args: Prisma.TimetableVersionFindUniqueArgs) => versions.findUnique(args),
              updateMany: (args: Prisma.TimetableVersionUpdateManyArgs) => typeof args.where?.id === "string"
                ? Promise.reject(new Error("injected status-update failure")) : versions.updateMany(args) } };
        return fn(Object.assign(Object.create(tx), patched));
      }, options as never);
    },
  }) as PrismaClient;
}

/** A sequential intervention: the competing write commits before the transaction starts. */
function withIntervention(store: DraftPublishStore, intervene: () => Promise<unknown>): DraftPublishStore {
  return { ...store, publishDraft: async (input) => { await intervene(); return store.publishDraft(input); } };
}

// ---------------------------------------------------------------------------
// Fixture database: scoped reads and the atomic publication transaction
// ---------------------------------------------------------------------------

const DEPARTMENTS = [{ id: "dept-f", name: "F", schoolId: "S" }];
const USERS = [{ id: OFFICER_ID, name: "Officer", email: "o@pub.test", passwordHash: "x", role: "OFFICER" },
  { id: "user-lect-f", name: "Lecturer F", email: "lf@pub.test", passwordHash: "x", role: "LECTURER", departmentId: "dept-f" },
  { id: "user-lect-g", name: "Lecturer G", email: "lg@pub.test", passwordHash: "x", role: "LECTURER", departmentId: "dept-f" }];
const LECTURERS = [{ id: "lect-f", userId: "user-lect-f", departmentId: "dept-f" }, { id: "lect-g", userId: "user-lect-g", departmentId: "dept-f" }];
const GROUPS = [{ id: "grp-1", name: "G1", size: 40, departmentId: "dept-f" }, { id: "grp-2", name: "G2", size: 30, departmentId: "dept-f" }];
const UNITS = [{ id: "unit-a", code: "A", title: "Unit A", departmentId: "dept-f", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-h", code: "H", title: "Unit H", departmentId: "dept-f", semester: 1, hoursPerWeek: 3, venueTypeRequired: "HALL", scheduled: true },
  { id: "unit-s2", code: "S2", title: "Unit S2", departmentId: "dept-f", semester: 2, hoursPerWeek: 3, venueTypeRequired: "HALL", scheduled: true }];
const TEACHINGS = [{ id: "teach-1", unitId: "unit-a", lecturerId: "lect-f", groupId: "grp-1", expectedSize: 40, sessionsPerWeek: 1, sessionLength: 1 },
  { id: "teach-2", unitId: "unit-h", lecturerId: "lect-g", groupId: "grp-2", expectedSize: 30, sessionsPerWeek: 1, sessionLength: 1 },
  { id: "teach-3", unitId: "unit-a", lecturerId: "lect-f", groupId: "grp-2", expectedSize: 30, sessionsPerWeek: 1, sessionLength: 1 },
  { id: "teach-s2", unitId: "unit-s2", lecturerId: "lect-g", groupId: "grp-1", expectedSize: 40, sessionsPerWeek: 1, sessionLength: 1 }];
const VENUES = [{ id: "venue-room", code: "RM", type: "ROOM", capacity: 50, ownerDepartmentId: "dept-f", facilities: "[]", status: "ACTIVE" },
  { id: "venue-lh", code: "LH", type: "HALL", capacity: 100, ownerDepartmentId: "dept-f", facilities: "[]", status: "ACTIVE" },
  { id: "venue-maint", code: "MT", type: "ROOM", capacity: 60, ownerDepartmentId: "dept-f", facilities: "[]", status: "MAINTENANCE" }];
const VERSIONS = [{ id: TARGET, semester: 1, status: "DRAFT", createdBy: OFFICER_ID, publishedAt: null },
  { id: "ver-pub-s1", semester: 1, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: new Date("2026-01-05T08:00:00.000Z") },
  { id: "ver-pub-s1b", semester: 1, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: new Date("2026-01-04T08:00:00.000Z") },
  { id: "ver-pub-s2", semester: 2, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: new Date("2026-01-06T08:00:00.000Z") },
  { id: "ver-arch", semester: 1, status: "ARCHIVED", createdBy: OFFICER_ID, publishedAt: new Date("2025-12-01T08:00:00.000Z") },
  { id: "ver-bad", semester: 1, status: "WAT", createdBy: OFFICER_ID, publishedAt: null }];
const ENTRIES = [{ id: "e-d1", versionId: TARGET, teachingId: "teach-1", venueId: "venue-room", day: "MON", start: "08:00", end: "09:00", locked: false },
  { id: "e-d2", versionId: TARGET, teachingId: "teach-2", venueId: "venue-lh", day: "TUE", start: "08:00", end: "09:00", locked: true },
  { id: "e-d3", versionId: TARGET, teachingId: "teach-3", venueId: "venue-maint", day: "WED", start: "09:00", end: "10:00", locked: false },
  { id: "e-p1", versionId: "ver-pub-s1", teachingId: "teach-1", venueId: "venue-room", day: "MON", start: "08:00", end: "09:00", locked: false },
  { id: "e-p1b", versionId: "ver-pub-s1b", teachingId: "teach-2", venueId: "venue-lh", day: "TUE", start: "08:00", end: "09:00", locked: false },
  { id: "e-p2", versionId: "ver-pub-s2", teachingId: "teach-s2", venueId: "venue-lh", day: "THU", start: "09:00", end: "10:00", locked: false },
  { id: "e-a1", versionId: "ver-arch", teachingId: "teach-1", venueId: "venue-room", day: "FRI", start: "10:00", end: "11:00", locked: false }];
const AVAILABILITY = [{ id: "la-block", lecturerId: "lect-f", day: "MON", start: "15:00", end: "16:00", available: false }, { id: "la-open", lecturerId: "lect-f", day: "TUE", start: "08:00", end: "09:00", available: true }];
const VENUE_CLOSED = [{ id: "vu-null", venueId: "venue-lh", day: "FRI", start: "14:00", end: "17:00", reason: null }, { id: "vu-exam", venueId: "venue-room", day: "WED", start: "12:00", end: "13:00", reason: "exam" }];

describe("draftPublishStorePrisma reads and atomic publish", () => {
  let db: PrismaClient;
  let dbPath: string;
  let store: DraftPublishStore;

  /** Clears every table this fixture touches and re-inserts it, parent-first. */
  async function seedFixture(): Promise<void> {
    await db.auditLog.deleteMany({}); await db.timetableEntry.deleteMany({}); await db.venueUnavailable.deleteMany({}); await db.lecturerAvailability.deleteMany({});
    await db.timetableVersion.deleteMany({}); await db.venue.deleteMany({}); await db.teaching.deleteMany({}); await db.unit.deleteMany({});
    await db.studentGroup.deleteMany({}); await db.lecturer.deleteMany({}); await db.user.deleteMany({}); await db.department.deleteMany({});
    await db.department.createMany({ data: DEPARTMENTS }); await db.user.createMany({ data: USERS }); await db.lecturer.createMany({ data: LECTURERS });
    await db.studentGroup.createMany({ data: GROUPS }); await db.unit.createMany({ data: UNITS }); await db.teaching.createMany({ data: TEACHINGS });
    await db.venue.createMany({ data: VENUES }); await db.timetableVersion.createMany({ data: VERSIONS }); await db.timetableEntry.createMany({ data: ENTRIES });
    await db.lecturerAvailability.createMany({ data: AVAILABILITY }); await db.venueUnavailable.createMany({ data: VENUE_CLOSED });
  }

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ({ client: db, filePath: dbPath } = makeTempDb("pubfix"));
    await seedFixture(); store = createDraftPublishStore(db);
  }, 60000);

  afterAll(async () => { vi.restoreAllMocks(); await disposeTempDb(db, dbPath); });
  afterEach(seedFixture);

  // --- helpers -------------------------------------------------------------

  const row = (id: string) => db.timetableVersion.findUnique({ where: { id } });
  const entryRows = (versionId: string) => db.timetableEntry.findMany({ where: { versionId }, orderBy: { id: "asc" } });
  const publishedIds = async (semester: number) => (await store.listPublishedVersionsBySemester(semester)).map((r) => r.id).sort();
  const publish = (source = store) => performDraftPublish(source, officer, { versionId: TARGET }, DEFAULT_POLICY, () => CLOCK);

  /** The snapshot this adapter can read right now, assembled like the service does. */
  async function snapshotOf(versionId: string, reverse = false): Promise<PublishSnapshot> {
    const version = await store.findVersion(versionId);
    if (version === null) throw new Error(`missing fixture version ${versionId}`);
    const raw = await store.listEntriesByVersion(versionId); const entries = reverse ? [...raw].reverse() : raw;
    const venueIds = [...new Set(entries.map((e) => e.venueId))];
    const teachings = await store.listTeachingsByIds([...new Set(entries.map((e) => e.teachingId))]);
    return { version, entries, teachings, venues: await store.listVenuesByIds(venueIds), policy: DEFAULT_POLICY,
      lecturerUnavailable: await store.listLecturerUnavailableByLecturerIds([...new Set(teachings.map((t) => t.lecturerId))]),
      venueUnavailable: await store.listVenueUnavailableByVenueIds(venueIds) };
  }

  async function txInput(over: Partial<PublishTransactionInput> = {}): Promise<PublishTransactionInput> {
    const version = await row(TARGET);
    return { versionId: TARGET, semester: version!.semester, publishedAt: CLOCK,
      expected: { snapshotFingerprint: publishSnapshotFingerprint(await snapshotOf(TARGET)), publishedVersionIds: await publishedIds(1), policy: DEFAULT_POLICY },
      audit: { actorId: OFFICER_ID, action: "TIMETABLE_PUBLISH", entity: "TimetableVersion", reason: `Published draft ${TARGET}.` }, ...over };
  }

  /** Nothing that refused may have changed a status or left an audit row. */
  async function expectNothingCommitted(): Promise<void> {
    const target = await row(TARGET); expect([target!.status, target!.publishedAt]).toEqual(["DRAFT", null]);
    expect(await db.timetableVersion.count({ where: { status: "PUBLISHED" } })).toBe(3);
    expect(await db.auditLog.count()).toBe(0);
  }

  /** A stale refusal commits nothing: the version rows are left exactly as the intervention put them (so no predecessor became ARCHIVED and the target was never stamped) and no publication audit exists. */
  async function expectStale(intervene: () => Promise<unknown>, reason: string): Promise<void> {
    let afterIntervention: unknown;
    const result = await publish(withIntervention(store, async () => { await intervene(); afterIntervention = await db.timetableVersion.findMany({ orderBy: { id: "asc" } }); }));
    expect(result).toEqual({ ok: false, kind: "STALE", reason });
    expect(await db.timetableVersion.findMany({ orderBy: { id: "asc" } })).toEqual(afterIntervention);
    expect(await db.auditLog.count()).toBe(0);
  }

  // --- 1 through 7: the scoped reads --------------------------------------

  it("reads a version row including its publication time", async () => {
    expect(await store.findVersion("ver-pub-s1")).toEqual({ id: "ver-pub-s1", semester: 1, status: "PUBLISHED", publishedAt: new Date("2026-01-05T08:00:00.000Z") });
    expect(await store.findVersion(TARGET)).toEqual({ id: TARGET, semester: 1, status: "DRAFT", publishedAt: null });
    expect(await store.findVersion("ver-ghost")).toBeNull();
  });

  it("throws instead of guessing an unreadable stored status", async () => {
    await expect(store.findVersion("ver-bad")).rejects.toThrow(/Invalid enum|corrupt status/i);
    const input = await txInput({ versionId: "ver-bad" });
    await expect(store.publishDraft(input)).rejects.toThrow(/corrupt status/i);
    await expectNothingCommitted();
  });

  it("returns only the requested version's entries, deterministically", async () => {
    expect((await store.listEntriesByVersion(TARGET)).map((e) => e.id)).toEqual(["e-d1", "e-d2", "e-d3"]);
    expect(await store.listEntriesByVersion("ver-pub-s2")).toEqual([expect.objectContaining({ id: "e-p2", locked: false })]);
    expect(await store.listEntriesByVersion(TARGET)).toEqual(await store.listEntriesByVersion(TARGET));
    expect(await store.listEntriesByVersion("ver-ghost")).toEqual([]);
    const row0 = (await store.listEntriesByVersion(TARGET))[0]!;
    expect(Object.keys(row0).sort()).toEqual(["day", "end", "id", "locked", "start", "teachingId", "venueId", "versionId"]);
  });

  it("maps teaching and venue rows onto the accepted row shapes", async () => {
    expect(await store.listTeachingsByIds(["teach-1", "teach-2", "teach-ghost"])).toEqual([
      { id: "teach-1", lecturerId: "lect-f", groupId: "grp-1", expectedSize: 40, unitCode: "A", venueTypeRequired: "ROOM" },
      { id: "teach-2", lecturerId: "lect-g", groupId: "grp-2", expectedSize: 30, unitCode: "H", venueTypeRequired: "HALL" }]);
    expect(await store.listVenuesByIds(["venue-lh", "venue-room"])).toEqual([
      { id: "venue-lh", code: "LH", capacity: 100, type: "HALL" }, { id: "venue-room", code: "RM", capacity: 50, type: "ROOM" }]);
    // A venue whose status changed is still the venue the entries reference.
    expect(await store.listVenuesByIds(["venue-maint"])).toEqual([{ id: "venue-maint", code: "MT", capacity: 60, type: "ROOM" }]);
    expect(await store.listTeachingsByIds([])).toEqual([]);
  });

  it("maps lecturer availability the way the M3 loader does: blocking rows only", async () => {
    expect(await store.listLecturerUnavailableByLecturerIds(["lect-f", "lect-g"])).toEqual([
      { id: "la-block", lecturerId: "lect-f", day: "MON", start: "15:00", end: "16:00", available: false }]);
    expect(await store.listLecturerUnavailableByLecturerIds(["lect-ghost"])).toEqual([]);
    // The service's read and the transaction's re-read are the same builder, so a snapshot assembled from either path carries the same availability rows.
    expect(publishSnapshotFingerprint(await snapshotOf(TARGET))).toBe(publishSnapshotFingerprint(await snapshotOf(TARGET)));
  });

  it("preserves a null venue-unavailability reason as null", async () => {
    expect(await store.listVenueUnavailableByVenueIds(["venue-lh", "venue-room"])).toEqual([
      { id: "vu-null", venueId: "venue-lh", day: "FRI", start: "14:00", end: "17:00", reason: null },
      { id: "vu-exam", venueId: "venue-room", day: "WED", start: "12:00", end: "13:00", reason: "exam" }]);
    expect((await store.listVenueUnavailableByVenueIds(["venue-lh"]))[0]!.reason).toBeNull();
  });

  it("reads published versions scoped to the requested semester, ordered by id", async () => {
    expect(await publishedIds(1)).toEqual(["ver-pub-s1", "ver-pub-s1b"]);
    expect(await publishedIds(2)).toEqual(["ver-pub-s2"]);
    expect(await store.listPublishedVersionsBySemester(2)).toEqual([{ id: "ver-pub-s2", semester: 2, status: "PUBLISHED", publishedAt: new Date("2026-01-06T08:00:00.000Z") }]);
    expect(await store.listPublishedVersionsBySemester(3)).toEqual([]);
  });

  // --- 8 through 15: the successful atomic publication ---------------------

  it("publishes a clean DRAFT, stamping it with the server clock", async () => {
    expect(await publish()).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: ["ver-pub-s1", "ver-pub-s1b"], publishedAt: CLOCK });
    const target = await row(TARGET);
    expect([target!.status, target!.publishedAt, target!.createdAt instanceof Date]).toEqual(["PUBLISHED", CLOCK, true]);
    expect((await store.findVersion(TARGET))!.status).toBe("PUBLISHED");
  });

  it("archives every PUBLISHED version of the target semester and only those", async () => {
    expect(await publish()).toMatchObject({ ok: true, archivedVersionIds: ["ver-pub-s1", "ver-pub-s1b"] });
    const statuses = (await db.timetableVersion.findMany({ orderBy: { id: "asc" } })).map((v) => [v.id, v.status]);
    expect(statuses).toEqual([["ver-arch", "ARCHIVED"], ["ver-bad", "WAT"], [TARGET, "PUBLISHED"],
      ["ver-pub-s1", "ARCHIVED"], ["ver-pub-s1b", "ARCHIVED"], ["ver-pub-s2", "PUBLISHED"]]);
    expect((await row("ver-pub-s2"))!.publishedAt).toEqual(new Date("2026-01-06T08:00:00.000Z"));
  });

  it("archives exactly one predecessor when only one is published", async () => {
    await db.timetableVersion.update({ where: { id: "ver-pub-s1b" }, data: { status: "ARCHIVED" } });
    expect(await publish()).toMatchObject({ ok: true, archivedVersionIds: ["ver-pub-s1"] });
    expect((await row("ver-pub-s1"))!.status).toBe("ARCHIVED");
  });

  it("publishes a first-ever draft with nothing to archive", async () => {
    await db.timetableVersion.updateMany({ where: { status: "PUBLISHED", semester: 1 }, data: { status: "ARCHIVED" } });
    expect(await publish()).toMatchObject({ ok: true, archivedVersionIds: [] });
    expect(await db.auditLog.findFirst({ where: { action: "TIMETABLE_PUBLISH" } })).toMatchObject({ reason: expect.stringContaining("no earlier version") });
    expect(await db.timetableVersion.count({ where: { status: "PUBLISHED", semester: 1 } })).toBe(1);
  });

  it("keeps every entry of an archived version and every entry of the target", async () => {
    const beforePub = await entryRows("ver-pub-s1"); const beforeTarget = await entryRows(TARGET);
    expect(await publish()).toMatchObject({ ok: true });
    expect(await entryRows("ver-pub-s1")).toEqual(beforePub); expect(await entryRows(TARGET)).toEqual(beforeTarget);
    expect(await entryRows("ver-pub-s1b")).toHaveLength(1);
    expect(await db.timetableEntry.count()).toBe(ENTRIES.length);
  });

  it("writes one publication audit for the version the officer published", async () => {
    expect(await publish()).toMatchObject({ ok: true });
    const audits = await db.auditLog.findMany({ where: { action: "TIMETABLE_PUBLISH" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: OFFICER_ID, entity: "TimetableVersion", entityId: TARGET,
      reason: expect.stringContaining("Published 3 entries of draft ver-draft (semester 1); archived ver-pub-s1, ver-pub-s1b") });
    expect([audits[0]!.at instanceof Date, await db.auditLog.count()]).toEqual([true, 1]);
  });

  // --- 16 through 26: refusals and stale protection -----------------------

  it("refuses to publish the same version twice", async () => {
    expect(await publish()).toMatchObject({ ok: true });
    expect(await publish()).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: TARGET, storedStatus: "PUBLISHED" });
    expect(await db.auditLog.count()).toBe(1);
    expect((await row(TARGET))!.publishedAt).toEqual(CLOCK);
  });

  it("refuses a target that does not exist, before and inside the transaction", async () => {
    expect(await performDraftPublish(store, officer, { versionId: "ver-ghost" }, DEFAULT_POLICY, () => CLOCK))
      .toEqual({ ok: false, kind: "VERSION_NOT_FOUND", versionId: "ver-ghost" });
    expect(await store.publishDraft(await txInput({ versionId: "ver-ghost" }))).toEqual({ stale: true, reason: "VERSION_NOT_FOUND" });
    await expectNothingCommitted();
  });

  it("refuses a non-DRAFT target inside the transaction", async () => {
    expect(await store.publishDraft(await txInput({ versionId: "ver-pub-s1" }))).toEqual({ stale: true, reason: "VERSION_NOT_DRAFT" });
    expect(await store.publishDraft(await txInput({ versionId: "ver-arch" }))).toEqual({ stale: true, reason: "VERSION_NOT_DRAFT" });
    await expectNothingCommitted();
  });

  it("refuses a target whose semester is no longer the validated one", async () => {
    const input = await txInput();
    expect(input.semester).toBe(1);
    await db.timetableVersion.update({ where: { id: TARGET }, data: { semester: 2 } });
    expect(await store.publishDraft(input)).toEqual({ stale: true, reason: "SNAPSHOT_CHANGED" });
    const moved = await row(TARGET);
    expect([moved!.status, moved!.publishedAt, moved!.semester]).toEqual(["DRAFT", null, 2]);
    expect(await db.timetableVersion.count({ where: { status: "PUBLISHED", semester: 2 } })).toBe(1);
    expect([(await row("ver-pub-s1"))!.status, await db.auditLog.count()]).toEqual(["PUBLISHED", 0]);
  });

  const stale: [string, () => Promise<unknown>][] = [
    ["an entry of the draft was moved", () => db.timetableEntry.update({ where: { id: "e-d1" }, data: { day: "THU" } })],
    ["an entry was added to the draft", () => db.timetableEntry.create({ data: { id: "e-extra", versionId: TARGET, teachingId: "teach-3", venueId: "venue-lh", day: "FRI", start: "08:00", end: "09:00", locked: false } })],
    ["an entry was locked", () => db.timetableEntry.update({ where: { id: "e-d1" }, data: { locked: true } })],
    ["a venue lost capacity", () => db.venue.update({ where: { id: "venue-room" }, data: { capacity: 10 } })],
    ["a venue changed type", () => db.venue.update({ where: { id: "venue-lh" }, data: { type: "LAB" } })],
    ["a lecturer became unavailable", () => db.lecturerAvailability.create({ data: { id: "la-new", lecturerId: "lect-f", day: "MON", start: "08:00", end: "09:00", available: false } })],
    ["a blocking period was lifted", () => db.lecturerAvailability.update({ where: { id: "la-block" }, data: { available: true } })],
    ["a venue closure was added", () => db.venueUnavailable.create({ data: { id: "vu-new", venueId: "venue-room", day: "MON", start: "08:00", end: "09:00", reason: "fire drill" } })],
    ["a null closure reason became empty text", () => db.venueUnavailable.update({ where: { id: "vu-null" }, data: { reason: "" } })],
    ["a unit code behind a teaching changed", () => db.unit.update({ where: { id: "unit-a" }, data: { code: "A-RENAMED" } })]];

  for (const [label, intervene] of stale) it(`refuses as SNAPSHOT_CHANGED when ${label} after the service's reads`, () => expectStale(intervene, "SNAPSHOT_CHANGED"));

  it("refuses a changed availability reason and a removed closure as stale", async () => {
    await expectStale(() => db.venueUnavailable.update({ where: { id: "vu-exam" }, data: { reason: "invigilation" } }), "SNAPSHOT_CHANGED");
    await expectStale(() => db.venueUnavailable.delete({ where: { id: "vu-exam" } }), "SNAPSHOT_CHANGED");
  });

  it("refuses when the published-version set changed under the draft", async () => {
    await expectStale(() => db.timetableVersion.create({ data: { id: "ver-rival", semester: 1, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: CLOCK } }), "PUBLISHED_SET_CHANGED");
    expect((await row("ver-rival"))!.status).toBe("PUBLISHED");
    await expectStale(() => db.timetableVersion.update({ where: { id: "ver-pub-s1" }, data: { status: "ARCHIVED" } }), "PUBLISHED_SET_CHANGED");
  });

  it("publishes the same draft from rows read in any order", async () => {
    expect(publishSnapshotFingerprint(await snapshotOf(TARGET, true))).toBe(publishSnapshotFingerprint(await snapshotOf(TARGET)));
    expect(await store.publishDraft(await txInput())).toEqual({ ok: true, archivedVersionIds: ["ver-pub-s1", "ver-pub-s1b"] });
    const archivedFirst = await row("ver-pub-s1b");
    expect([archivedFirst!.status, archivedFirst!.publishedAt]).toEqual(["ARCHIVED", new Date("2026-01-04T08:00:00.000Z")]);
  });

  // --- 27 and 28: rollback of the writes that already ran -----------------

  it("rolls archiving and publication back when the audit insert fails", async () => {
    expect(await publish(createDraftPublishStore(withFailingWrite(db, "audit")))).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    await expectNothingCommitted();
    expect([(await row("ver-pub-s1"))!.status, (await row("ver-pub-s1b"))!.status]).toEqual(["PUBLISHED", "PUBLISHED"]);
  });

  it("rolls every archive update back when the target stamp fails", async () => {
    expect(await publish(createDraftPublishStore(withFailingWrite(db, "target")))).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    await expectNothingCommitted();
    const statuses = (await db.timetableVersion.findMany({ where: { id: "ver-pub-s1" }, orderBy: { id: "asc" } })).map((v) => [v.id, v.status, v.publishedAt]);
    expect(statuses).toEqual([["ver-pub-s1", "PUBLISHED", new Date("2026-01-05T08:00:00.000Z")]]);
  });

  it("never publishes when the audit actor does not exist", async () => {
    const input = await txInput();
    input.audit.actorId = "user-ghost";
    await expect(store.publishDraft(input)).rejects.toThrow();
    await expectNothingCommitted();
    expect((await row("ver-pub-s1"))!.status).toBe("PUBLISHED");
  });
});

// ---------------------------------------------------------------------------
// Seeded database: the real service plus this adapter on the full seed data
// ---------------------------------------------------------------------------

const CLEAN_SEED = seedTimetableEntries.filter((entry) => entry.id.startsWith("entry-clean-"));
const copyEntries = (versionId: string, prefix: string) => CLEAN_SEED.map((entry, index) => ({
  id: `${prefix}-${index}`, versionId, teachingId: entry.teachingId, venueId: entry.venueId,
  day: entry.day, start: entry.start, end: entry.end, locked: false }));

describe("draftPublishStorePrisma seeded publication (real service)", () => {
  let db: PrismaClient;
  let dbPath: string;
  const SEED_CLOCK = new Date("2026-03-02T10:00:00.000Z");

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ({ client: db, filePath: dbPath } = makeTempDb("pubseed"));
    for (const row of seedDepartments) await db.department.create({ data: row });
    for (const row of seedStudentGroups) await db.studentGroup.create({ data: row });
    for (const { id, name, email, role, departmentId, studentGroupId } of seedUsers) await db.user.create({ data: { id, name, email, role, departmentId, studentGroupId, passwordHash: "seed-placeholder" } });
    for (const row of seedLecturers) await db.lecturer.create({ data: row });
    for (const row of seedUnits) await db.unit.create({ data: row });
    for (const row of seedTeachings) await db.teaching.create({ data: row });
    for (const { facilities, ...row } of seedVenues) await db.venue.create({ data: { ...row, facilities: JSON.stringify(facilities) } });
    for (const row of seedVenueUnavailabilities) await db.venueUnavailable.create({ data: row });
    for (const row of seedLecturerAvailabilities) await db.lecturerAvailability.create({ data: row });
    for (const row of seedTimetableVersions) await db.timetableVersion.create({ data: row });
    for (const row of seedTimetableEntries) await db.timetableEntry.create({ data: row });
    // The seed ships one DRAFT and no published version, so the lifecycle needs
    // a current published version per semester plus a conflict-free draft, built
    // from the seed's own clean entries and the seed's own teachings and venues.
    expect(CLEAN_SEED).toHaveLength(6);
    await db.timetableVersion.createMany({ data: [
      { id: "ver-seed-clean", semester: 1, status: "DRAFT", createdBy: OFFICER_ID },
      { id: "ver-seed-pub", semester: 1, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: new Date("2026-02-01T08:00:00.000Z") },
      { id: "ver-seed-pub-s2", semester: 2, status: "PUBLISHED", createdBy: OFFICER_ID, publishedAt: new Date("2026-02-02T08:00:00.000Z") }] });
    await db.timetableEntry.createMany({ data: [...copyEntries("ver-seed-clean", "copy-clean"), ...copyEntries("ver-seed-pub", "copy-pub")] });
  }, 120000);

  afterAll(async () => { vi.restoreAllMocks(); await disposeTempDb(db, dbPath); });

  const seedStore = () => createDraftPublishStore(db);
  const publishSeed = (versionId: string) => performDraftPublish(seedStore(), officer, { versionId }, DEFAULT_POLICY, () => SEED_CLOCK);
  it("refuses the planted-conflict draft with zero hard-rule workarounds", async () => {
    const versionsBefore = await db.timetableVersion.findMany({ orderBy: { id: "asc" } });
    const result = await publishSeed("ver-s1-planted");
    if (result.ok || result.kind !== "HARD_VIOLATIONS") throw new Error(`expected HARD_VIOLATIONS, got ${JSON.stringify(result)}`);
    expect(result.violations.map((violation) => violation.type).sort()).toEqual(["LECTURER_OVERLAP", "VENUE_OVERLAP"]);
    expect(result.violations.every((violation) => violation.message.length > 20)).toBe(true);
    expect([await db.timetableVersion.findMany({ orderBy: { id: "asc" } }), await db.auditLog.count()]).toEqual([versionsBefore, 0]);
  });

  it("refuses as stale when the seeded draft changes between its validation and the commit", async () => {
    const versionsBefore = await db.timetableVersion.findMany({ orderBy: { id: "asc" } });
    const intervene = () => db.timetableEntry.update({ where: { id: "copy-clean-0" }, data: { day: "SAT" } });
    expect(await performDraftPublish(withIntervention(seedStore(), intervene), officer, { versionId: "ver-seed-clean" }, DEFAULT_POLICY, () => SEED_CLOCK))
      .toEqual({ ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" });
    expect([await db.timetableVersion.findMany({ orderBy: { id: "asc" } }), await db.auditLog.count()]).toEqual([versionsBefore, 0]);
    // The competing write is undone here, so the publication tests below validate the same clean draft.
    await db.timetableEntry.update({ where: { id: "copy-clean-0" }, data: { day: CLEAN_SEED[0]!.day } });
  });

  it("publishes a clean seeded draft and archives the version it replaced", async () => {
    const planted = await db.timetableEntry.findMany({ where: { versionId: "ver-s1-planted" }, orderBy: { id: "asc" } });
    const archivedBefore = await db.timetableEntry.findMany({ where: { versionId: "ver-seed-pub" }, orderBy: { id: "asc" } });
    expect(await publishSeed("ver-seed-clean")).toEqual({ ok: true, versionId: "ver-seed-clean", semester: 1, archivedVersionIds: ["ver-seed-pub"], publishedAt: SEED_CLOCK });
    const status = async (id: string) => { const v = await db.timetableVersion.findUnique({ where: { id } }); return [v!.status, v!.publishedAt]; };
    expect(await status("ver-seed-clean")).toEqual(["PUBLISHED", SEED_CLOCK]);
    expect(await status("ver-seed-pub")).toEqual(["ARCHIVED", new Date("2026-02-01T08:00:00.000Z")]);
    expect(await status("ver-seed-pub-s2")).toEqual(["PUBLISHED", new Date("2026-02-02T08:00:00.000Z")]);
    expect(await status("ver-s1-planted")).toEqual(["DRAFT", null]);
    expect(await db.timetableEntry.findMany({ where: { versionId: "ver-s1-planted" }, orderBy: { id: "asc" } })).toEqual(planted);
    expect(await db.timetableEntry.findMany({ where: { versionId: "ver-seed-pub" }, orderBy: { id: "asc" } })).toEqual(archivedBefore);
    expect(await db.timetableVersion.count({ where: { status: "PUBLISHED", semester: 1 } })).toBe(1);
    const audit = await db.auditLog.findFirst({ where: { action: "TIMETABLE_PUBLISH" } });
    expect(audit).toMatchObject({ actorId: OFFICER_ID, entity: "TimetableVersion", entityId: "ver-seed-clean" });
    expect([audit!.reason, await db.auditLog.count()]).toEqual([expect.stringContaining("Published 6 entries of draft ver-seed-clean (semester 1); archived ver-seed-pub"), 1]);
  });

  it("refuses the seeded draft again once it is the published one", async () => {
    expect(await publishSeed("ver-seed-clean")).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: "ver-seed-clean", storedStatus: "PUBLISHED" });
    expect(await publishSeed("ver-seed-pub")).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: "ver-seed-pub", storedStatus: "ARCHIVED" });
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.timetableVersion.count({ where: { status: "PUBLISHED", semester: 1 } })).toBe(1);
  });

  it("never re-stamps a version that already carries a publication time", async () => {
    await db.timetableVersion.update({ where: { id: "ver-s1-planted" }, data: { publishedAt: SEED_CLOCK } });
    expect(await publishSeed("ver-s1-planted")).toEqual({ ok: false, kind: "INVALID_VERSION_DATA", versionId: "ver-s1-planted",
      reason: "PUBLISHED_AT_ON_DRAFT", message: expect.stringContaining("inconsistent") });
    expect(await db.auditLog.count()).toBe(1);
    expect((await db.timetableVersion.findUnique({ where: { id: "ver-s1-planted" } }))!.status).toBe("DRAFT");
  });
});
