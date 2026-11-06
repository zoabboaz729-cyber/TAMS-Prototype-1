/**
 * M4-T2b — isolated-database integration tests for the Prisma generate store.
 *
 * Every test runs against a fresh SQLite file in the OS temp directory
 * (schema pushed with `prisma db push`, deleted in `afterAll`). The working
 * `prisma/dev.db` is never opened. Tests exercise real Prisma reads and real
 * transaction behaviour — commits, foreign-key failures and rollbacks — not
 * mocked clients. Stale rejection is proven sequentially (an intervening
 * change is committed before the write starts); no test claims proven race
 * safety, and DECISIONS.md records what SQLite does and does not guarantee.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  seedDepartments, seedLecturerAvailabilities, seedLecturers, seedStudentGroups,
  seedTeachings, seedTimetableEntries, seedTimetableVersions, seedUnits, seedUsers,
  seedVenueUnavailabilities, seedVenues,
} from "@/domain/seedData";
import { performDraftGenerate } from "@/server/draftGenerate";
import {
  lockedFingerprint, type GenerateAuditDraft, type GeneratedDraftPayload,
} from "@/server/draftGenerateContract";
import { createDraftGenerateStore } from "@/server/draftGenerateStorePrisma";

const OFFICER_ID = "user-officer";
const officer = { id: OFFICER_ID, role: "OFFICER", departmentId: null, studentGroupId: null } as const;
const FIXTURE_VERSIONS = ["ver-draft", "ver-pub", "ver-arch"];

function makeTempDb(prefix: string): { client: PrismaClient; filePath: string } {
  const filePath = path.join(os.tmpdir(), `tams-${prefix}-test-${Date.now()}.db`);
  const url = `file:${filePath.replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30000,
  });
  return { client: new PrismaClient({ datasources: { db: { url } } }), filePath };
}

function disposeTempDb(client: PrismaClient, filePath: string): Promise<unknown> {
  return client.$disconnect().then(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
}

/**
 * Failure injection without touching production code: the store's own
 * `$transaction` callback receives the real bound transaction client, and we
 * hand the adapter a proxy whose `auditLog.create` always rejects. The
 * failure therefore lands exactly at the audit stage — after the version and
 * every entry insert — and Prisma must roll all of them back.
 */
function withFailingAuditCreate(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (fn: (tx: object) => Promise<unknown>, options?: unknown) =>
          target.$transaction(
            (tx) => fn(Object.assign(Object.create(tx), {
              auditLog: { create: () => Promise.reject(new Error("injected audit insert failure")) },
            })),
            options as never,
          );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

// ---------------------------------------------------------------------------
// Fixture database: scoped reads and the atomic persistence transaction
// ---------------------------------------------------------------------------

describe("draftGenerateStorePrisma reads and atomic persist", () => {
  let db: PrismaClient;
  let dbPath: string;
  let store: ReturnType<typeof createDraftGenerateStore>;

  const mkUnit = (id: string, code: string, semester: number, scheduled: boolean, departmentId = "dept-f") =>
    ({ data: { id, code, title: code, departmentId, semester, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled } });
  const mkTeaching = (id: string, unitId: string, groupId: string, expectedSize: number, sessionsPerWeek: number) =>
    ({ data: { id, unitId, lecturerId: "lect-f", groupId, expectedSize, sessionsPerWeek, sessionLength: 1 } });
  const mkVenue = (id: string, code: string, type: string, capacity: number, status: string) =>
    ({ data: { id, code, type, capacity, ownerDepartmentId: "dept-f", facilities: "[]", status } });
  const mkEntry = (id: string, versionId: string, teachingId: string, venueId: string, day: string, start: string, end: string, locked: boolean) =>
    ({ data: { id, versionId, teachingId, venueId, day, start, end, locked } });

  beforeAll(async () => {
    ({ client: db, filePath: dbPath } = makeTempDb("genfix"));
    await db.department.createMany({ data: [
      { id: "dept-f", name: "F", schoolId: "S" }, { id: "dept-x", name: "X", schoolId: "S" },
    ] });
    await db.user.createMany({ data: [
      { id: OFFICER_ID, name: "Officer", email: "o@gen.test", passwordHash: "x", role: "OFFICER" },
      { id: "user-lect-f", name: "Lecturer F", email: "lf@gen.test", passwordHash: "x", role: "LECTURER", departmentId: "dept-f" },
    ] });
    await db.studentGroup.createMany({ data: [
      { id: "grp-1", name: "G1", size: 40, departmentId: "dept-f" },
      { id: "grp-2", name: "G2", size: 30, departmentId: "dept-f" },
    ] });
    await db.lecturer.create({ data: { id: "lect-f", userId: "user-lect-f", departmentId: "dept-f" } });
    await db.unit.createMany({ data: [
      mkUnit("unit-a", "A", 1, true).data, mkUnit("unit-unsch", "U", 1, false).data,
      mkUnit("unit-s2", "B", 2, true).data, mkUnit("unit-empty", "E", 3, true, "dept-x").data,
    ] });
    await db.teaching.createMany({ data: [
      mkTeaching("teach-1", "unit-a", "grp-1", 40, 2).data,
      mkTeaching("teach-2f", "unit-a", "grp-2", 30, 2).data,
      mkTeaching("teach-unsch", "unit-unsch", "grp-2", 30, 1).data,
      mkTeaching("teach-s2", "unit-s2", "grp-1", 40, 1).data,
    ] });
    await db.venue.createMany({ data: [
      mkVenue("venue-lh", "LH", "HALL", 100, "ACTIVE").data,
      mkVenue("venue-room", "RM", "ROOM", 50, "ACTIVE").data,
      mkVenue("venue-off", "OFF", "ROOM", 50, "INACTIVE").data,
      mkVenue("venue-maint", "MNT", "ROOM", 50, "MAINTENANCE").data,
    ] });
    await db.lecturerAvailability.createMany({ data: [
      { id: "la-block", lecturerId: "lect-f", day: "MON", start: "15:00", end: "17:00", available: false },
      { id: "la-open", lecturerId: "lect-f", day: "TUE", start: "08:00", end: "09:00", available: true },
    ] });
    await db.venueUnavailable.create({
      data: { id: "vu-lh", venueId: "venue-lh", day: "FRI", start: "14:00", end: "17:00", reason: "fixture maintenance" },
    });
    await db.timetableVersion.createMany({ data: [
      { id: "ver-draft", semester: 1, status: "DRAFT", createdBy: OFFICER_ID },
      { id: "ver-pub", semester: 1, status: "PUBLISHED", createdBy: OFFICER_ID },
      { id: "ver-arch", semester: 1, status: "ARCHIVED", createdBy: OFFICER_ID },
    ] });
    await db.timetableEntry.createMany({ data: [
      mkEntry("e-d1", "ver-draft", "teach-1", "venue-lh", "MON", "08:00", "09:00", true).data,
      mkEntry("e-d2", "ver-draft", "teach-2f", "venue-room", "WED", "10:00", "11:00", false).data,
      mkEntry("e-u1", "ver-draft", "teach-1", "venue-room", "THU", "09:00", "10:00", false).data,
      mkEntry("e-pub", "ver-pub", "teach-1", "venue-lh", "MON", "08:00", "09:00", true).data,
    ] });
    store = createDraftGenerateStore(db);
  }, 60000);

  afterAll(() => disposeTempDb(db, dbPath));

  afterEach(async () => {
    // Full reset of the source-side fixture, including rows a test may have
    // deleted (deleting ver-draft cascades its entries away).
    await db.timetableEntry.deleteMany({ where: { versionId: { notIn: FIXTURE_VERSIONS } } });
    await db.timetableVersion.deleteMany({ where: { id: { notIn: FIXTURE_VERSIONS } } });
    await db.auditLog.deleteMany({});
    await db.timetableEntry.deleteMany({ where: { versionId: "ver-draft" } });
    await db.timetableVersion.deleteMany({ where: { id: "ver-draft" } });
    await db.timetableVersion.create({ data: { id: "ver-draft", semester: 1, status: "DRAFT", createdBy: OFFICER_ID } });
    await db.timetableEntry.createMany({ data: [
      mkEntry("e-d1", "ver-draft", "teach-1", "venue-lh", "MON", "08:00", "09:00", true).data,
      mkEntry("e-d2", "ver-draft", "teach-2f", "venue-room", "WED", "10:00", "11:00", false).data,
    ] });
  });

  async function tokenFor(versionId: string) {
    const version = await store.findVersion(versionId);
    if (version === null) throw new Error(`missing fixture version ${versionId}`);
    const locked = await store.listLockedEntriesByVersion(versionId);
    return {
      locked,
      token: { versionId: version.id, versionStatus: version.status, lockedFingerprint: lockedFingerprint(locked) },
    };
  }

  function persistInput(
    semester: number,
    entries: GeneratedDraftPayload["entries"],
    expectedSource: GeneratedDraftPayload["expectedSource"],
  ): { payload: GeneratedDraftPayload; audit: GenerateAuditDraft } {
    return {
      payload: {
        semester, status: "DRAFT", createdBy: OFFICER_ID,
        sourceVersionId: expectedSource?.versionId ?? null, expectedSource, softScore: 3, entries,
      },
      audit: {
        actorId: OFFICER_ID, action: "TIMETABLE_DRAFT_GENERATE", entity: "TimetableVersion",
        reason: `Generated ${entries.length} entries for semester ${semester}; soft score 3.`,
      },
    };
  }

  const copiedEntry = (sourceEntryId: string): GeneratedDraftPayload["entries"][number] =>
    ({ teachingId: "teach-1", venueId: "venue-lh", day: "MON", start: "08:00", end: "09:00", locked: true, sourceEntryId });
  const plainEntry = (day: string, start: string, end: string): GeneratedDraftPayload["entries"][number] =>
    ({ teachingId: "teach-2f", venueId: "venue-room", day, start, end, locked: false, sourceEntryId: null });
  async function expectStale(input: { payload: GeneratedDraftPayload; audit: GenerateAuditDraft }) {
    expect(await store.persistGeneratedDraft(input.payload, input.audit)).toEqual({ stale: true });
    await expectNothingWritten();
  }
  async function expectNothingWritten() {
    expect(await db.timetableVersion.count({ where: { id: { notIn: FIXTURE_VERSIONS } } })).toBe(0);
    expect(await db.timetableEntry.count({ where: { versionId: { notIn: FIXTURE_VERSIONS } } })).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  }

  it("returns only scheduled teachings of the requested semester, with full generator fields", async () => {
    const read = await store.listTeachingsForSemester(1);
    expect(read.teachings.map((row) => row.id)).toEqual(["teach-1", "teach-2f"]);
    expect(read.teachings[0]).toMatchObject({
      lecturerId: "lect-f", groupId: "grp-1", expectedSize: 40, sessionsPerWeek: 2,
      sessionLength: 1, unitCode: "A", venueTypeRequired: "ROOM", semester: 1, scheduled: true,
    });
    expect(read.teachings.every((row) => row.scheduled)).toBe(true);
  });

  it("distinguishes an existing semester without scheduled teachings from an absent one", async () => {
    expect(await store.listTeachingsForSemester(3)).toEqual({ semesterExists: true, teachings: [] });
    expect(await store.listTeachingsForSemester(4)).toEqual({ semesterExists: false, teachings: [] });
  });

  it("returns only ACTIVE venues with id, code, type and capacity", async () => {
    const venues = await store.listActiveVenues();
    expect(venues.map((venue) => venue.id).sort()).toEqual(["venue-lh", "venue-room"]);
    expect(venues.find((venue) => venue.id === "venue-lh")).toEqual({
      id: "venue-lh", code: "LH", capacity: 100, type: "HALL",
    });
  });

  it("returns only available:false lecturer periods, filtered to the requested ids", async () => {
    const rows = await store.listLecturerUnavailableByLecturerIds(["lect-f"]);
    expect(rows.map((row) => row.id)).toEqual(["la-block"]);
    expect(rows.every((row) => row.available === false)).toBe(true);
    expect(await store.listLecturerUnavailableByLecturerIds(["lect-ghost"])).toEqual([]);
  });

  it("loads venue unavailability with day, start, end and reason", async () => {
    expect(await store.listVenueUnavailableByVenueIds(["venue-lh", "venue-room"])).toEqual([
      { id: "vu-lh", venueId: "venue-lh", day: "FRI", start: "14:00", end: "17:00", reason: "fixture maintenance" },
    ]);
  });

  it("returns only locked rows of the requested version, in a deterministic order", async () => {
    expect((await store.listLockedEntriesByVersion("ver-draft")).map((row) => row.id)).toEqual(["e-d1"]);
    expect(await store.listLockedEntriesByVersion("ver-pub")).toEqual([
      expect.objectContaining({ id: "e-pub" }),
    ]);
    const first = await store.listLockedEntriesByVersion("ver-draft");
    expect(await store.listLockedEntriesByVersion("ver-draft")).toEqual(first);
  });

  it("persists a complete board as a new DRAFT version under fresh ids", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    const input = persistInput(1, [
      copiedEntry(locked[0].id), plainEntry("TUE", "09:00", "10:00"), plainEntry("WED", "10:00", "11:00"),
    ], token);
    const result = await store.persistGeneratedDraft(input.payload, input.audit);
    expect("ok" in result && result.ok).toBe(true);
    if (!("ok" in result)) return;
    expect(result.versionId).not.toBe("ver-draft");
    const newVersion = await db.timetableVersion.findUnique({ where: { id: result.versionId } });
    expect(newVersion).toMatchObject({ status: "DRAFT", semester: 1, createdBy: OFFICER_ID });
    const newEntries = await db.timetableEntry.findMany({ where: { versionId: result.versionId } });
    expect(newEntries.length).toBe(3);
    expect(newEntries.every((row) => row.versionId === result.versionId)).toBe(true);
  });

  it("copies locked entries with fresh ids, keeps their schedule and lock, and leaves the source untouched", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    const sourceBefore = await db.timetableEntry.findMany({ where: { versionId: "ver-draft" }, orderBy: { id: "asc" } });
    const versionBefore = await db.timetableVersion.findUnique({ where: { id: "ver-draft" } });
    const input = persistInput(1, [copiedEntry(locked[0].id), plainEntry("TUE", "09:00", "10:00")], token);
    const result = await store.persistGeneratedDraft(input.payload, input.audit);
    expect("ok" in result && result.ok).toBe(true);
    if (!("ok" in result)) return;
    const copied = (await db.timetableEntry.findMany({ where: { versionId: result.versionId, locked: true } }))
      .find((row) => row.teachingId === "teach-1");
    expect(copied).toMatchObject({ day: "MON", start: "08:00", end: "09:00", venueId: "venue-lh", locked: true });
    expect(copied!.id).not.toBe("e-d1");
    expect(await db.timetableEntry.findMany({ where: { versionId: "ver-draft" }, orderBy: { id: "asc" } }))
      .toEqual(sourceBefore);
    expect(await db.timetableVersion.findUnique({ where: { id: "ver-draft" } })).toEqual(versionBefore);
  });

  it("writes one main generate audit and one mapping audit per copied locked entry", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    const input = persistInput(1, [copiedEntry(locked[0].id), plainEntry("TUE", "09:00", "10:00")], token);
    const result = await store.persistGeneratedDraft(input.payload, input.audit);
    expect("ok" in result && result.ok).toBe(true);
    if (!("ok" in result)) return;
    const main = await db.auditLog.findFirst({ where: { action: "TIMETABLE_DRAFT_GENERATE" } });
    expect(main).toMatchObject({ actorId: OFFICER_ID, entity: "TimetableVersion", entityId: result.versionId });
    expect(main!.reason).toContain("Generated 2 entries for semester 1");
    const copies = await db.auditLog.findMany({ where: { action: "TIMETABLE_LOCKED_ENTRY_COPY" } });
    expect(copies.length).toBe(1);
    const newEntry = await db.timetableEntry.findFirst({ where: { versionId: result.versionId, locked: true } });
    expect(copies[0]).toMatchObject({ entity: "TimetableEntry", entityId: newEntry!.id, actorId: OFFICER_ID });
    expect(copies[0].reason).toContain("Copied locked entry e-d1 from source version ver-draft");
    expect(copies[0].reason).toContain(`to new entry ${newEntry!.id} in version ${result.versionId}`);
  });

  it("refuses a source whose locked row was unlocked, writing nothing", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    await db.timetableEntry.update({ where: { id: "e-d1" }, data: { locked: false } });
    await expectStale(persistInput(1, [copiedEntry(locked[0].id)], token));
  });

  it("refuses a source whose locked schedule changed and keeps the competing change", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    await db.timetableEntry.update({ where: { id: "e-d1" }, data: { day: "TUE" } });
    await expectStale(persistInput(1, [copiedEntry(locked[0].id)], token));
    expect((await db.timetableEntry.findUnique({ where: { id: "e-d1" } }))!.day).toBe("TUE");
  });

  it("refuses a source whose locked set grew after the token was taken", async () => {
    // M4-T2c1 correction: the source stays a real DRAFT for the whole test, so
    // the grown locked set — not an ARCHIVED status — is the only reason the
    // write can be refused. The previous version took the token from ver-arch,
    // which the transaction rejects on status alone.
    const { locked, token } = await tokenFor("ver-draft");
    expect((await store.findVersion("ver-draft"))?.status).toBe("DRAFT");
    // e-d2 belongs to this same source and was unlocked when the token was
    // taken; locking it adds a row to the fingerprint the write recomputes.
    await db.timetableEntry.update({ where: { id: "e-d2" }, data: { locked: true } });
    const grown = persistInput(1, [copiedEntry(locked[0].id)], token);
    await expectStale(grown);
    expect((await db.timetableEntry.findUnique({ where: { id: "e-d2" } }))!.locked).toBe(true);
    // Isolation proof: the byte-identical payload commits once the token is
    // recomputed, so the source's status and semester were never the obstacle.
    const { token: recomputed } = await tokenFor("ver-draft");
    const control = await store.persistGeneratedDraft(
      persistInput(1, [copiedEntry(locked[0].id)], recomputed).payload,
      grown.audit,
    );
    expect("ok" in control && control.ok).toBe(true);
  });

  it("refuses PUBLISHED, ARCHIVED and deleted sources as stale, writing nothing", async () => {
    const pub = await tokenFor("ver-pub");
    await expectStale(persistInput(1, [copiedEntry(pub.locked[0].id)], pub.token));
    await expectStale(persistInput(1, [], (await tokenFor("ver-arch")).token));
    const draft = await tokenFor("ver-draft");
    await db.timetableVersion.delete({ where: { id: "ver-draft" } });
    await expectStale(persistInput(1, [copiedEntry(draft.locked[0].id)], draft.token));
  });

  it("refuses a source whose semester no longer matches the generated scope", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    await db.timetableVersion.update({ where: { id: "ver-draft" }, data: { semester: 2 } });
    await expectStale(persistInput(1, [copiedEntry(locked[0].id)], token));
  });

  it("throws instead of reporting stale when the stored source status is corrupt", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    await db.$executeRaw`UPDATE "TimetableVersion" SET "status" = 'WAT' WHERE "id" = 'ver-draft'`;
    const input = persistInput(1, [copiedEntry(locked[0].id)], token);
    await expect(store.persistGeneratedDraft(input.payload, input.audit)).rejects.toThrow(/corrupt status/i);
    await expectNothingWritten();
  });

  it("rolls the whole transaction back when an entry references a missing teaching", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    const ghost = { ...plainEntry("TUE", "09:00", "10:00"), teachingId: "teach-ghost" };
    const input = persistInput(1, [copiedEntry(locked[0].id), ghost], token);
    await expect(store.persistGeneratedDraft(input.payload, input.audit)).rejects.toThrow();
    await expectNothingWritten();
  });

  it("rolls back when an entry references a missing venue or the creator does not exist", async () => {
    const ghostVenue = { ...plainEntry("TUE", "09:00", "10:00"), venueId: "venue-ghost" };
    const input1 = persistInput(1, [ghostVenue], null);
    await expect(store.persistGeneratedDraft(input1.payload, input1.audit)).rejects.toThrow();
    await expectNothingWritten();
    const input2 = persistInput(1, [plainEntry("TUE", "09:00", "10:00")], null);
    input2.payload.createdBy = "user-ghost";
    await expect(store.persistGeneratedDraft(input2.payload, input2.audit)).rejects.toThrow();
    await expectNothingWritten();
  });

  it("rolls back version and entries when the audit insert itself fails after the entry inserts", async () => {
    const { locked, token } = await tokenFor("ver-draft");
    const input = persistInput(1, [copiedEntry(locked[0].id), plainEntry("TUE", "09:00", "10:00")], token);
    const injectedStore = createDraftGenerateStore(withFailingAuditCreate(db));
    await expect(injectedStore.persistGeneratedDraft(input.payload, input.audit))
      .rejects.toThrow(/injected audit insert failure/);
    await expectNothingWritten();
  });

  it("succeeds for a source-free generation with no mapping audits", async () => {
    const input = persistInput(1, [plainEntry("MON", "08:00", "09:00"), plainEntry("TUE", "09:00", "10:00")], null);
    const result = await store.persistGeneratedDraft(input.payload, input.audit);
    expect("ok" in result && result.ok).toBe(true);
    expect(await db.auditLog.count({ where: { action: "TIMETABLE_LOCKED_ENTRY_COPY" } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "TIMETABLE_DRAFT_GENERATE" } })).toBe(1);
  });

  it("keeps repeated ordered reads identical (contract ordering is deterministic)", async () => {
    const teachings = await store.listTeachingsForSemester(2);
    expect(teachings.teachings.map((row) => row.id)).toEqual(["teach-s2"]);
    expect(await store.listTeachingsForSemester(2)).toEqual(teachings);
    const venues = await store.listActiveVenues();
    expect(await store.listActiveVenues()).toEqual(venues);
  });
});

// ---------------------------------------------------------------------------
// Seeded database: the real service plus this adapter on the full seed data
// ---------------------------------------------------------------------------

describe("draftGenerateStorePrisma seeded partial generation (real service)", () => {
  let db: PrismaClient;
  let dbPath: string;

  beforeAll(async () => {
    ({ client: db, filePath: dbPath } = makeTempDb("genseed"));
    for (const row of seedDepartments) await db.department.create({ data: row });
    for (const row of seedStudentGroups) await db.studentGroup.create({ data: row });
    for (const { id, name, email, role, departmentId, studentGroupId } of seedUsers) {
      await db.user.create({ data: { id, name, email, role, departmentId, studentGroupId, passwordHash: "seed-placeholder" } });
    }
    for (const row of seedLecturers) await db.lecturer.create({ data: row });
    for (const row of seedUnits) await db.unit.create({ data: row });
    for (const row of seedTeachings) await db.teaching.create({ data: row });
    for (const { facilities, ...row } of seedVenues) {
      await db.venue.create({ data: { ...row, facilities: JSON.stringify(facilities) } });
    }
    for (const row of seedVenueUnavailabilities) await db.venueUnavailable.create({ data: row });
    for (const row of seedLecturerAvailabilities) await db.lecturerAvailability.create({ data: row });
    for (const row of seedTimetableVersions) await db.timetableVersion.create({ data: row });
    for (const row of seedTimetableEntries) await db.timetableEntry.create({ data: row });  }, 120000);

  afterAll(() => disposeTempDb(db, dbPath));

  it("writes no version when the seeded semester can only generate partially", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createDraftGenerateStore(db);
    const versionsBefore = await db.timetableVersion.findMany({ orderBy: { id: "asc" } });
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    // Measured per-semester figures (the combined two-semester seed is the
    // 81/9 case quoted in M4-T1): semester 1 holds 18 scheduled teachings
    // with 54 owed sessions; 51 place and the three SE-Y4 lab sessions of
    // 45-student groups have no LAB with the required capacity.
    expect(result).toMatchObject({ ok: false, kind: "PARTIAL_GENERATION", placedCount: 51 });
    if (result.ok || result.kind !== "PARTIAL_GENERATION") return;
    expect(result.unplaced.length).toBe(3);
    expect(result.unplaced.every((row) => row.reason === "NO_COMPATIBLE_VENUE")).toBe(true);
    expect(await db.timetableVersion.findMany({ orderBy: { id: "asc" } })).toEqual(versionsBefore);
    expect(await db.auditLog.count({ where: { action: "TIMETABLE_DRAFT_GENERATE" } })).toBe(0);
    vi.restoreAllMocks();
  });
});
