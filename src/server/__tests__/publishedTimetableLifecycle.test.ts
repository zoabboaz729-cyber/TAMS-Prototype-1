/**
 * M4-T4f — real SQLite publication-to-view lifecycle regression.
 *
 * One disposable database (fs.mkdtempSync under os.tmpdir(), unique per-invocation
 * name, schema pushed only to that explicit URL) is injected into BOTH accepted
 * adapters. Publication runs only through performDraftPublish(), reads only through
 * readPublishedTimetable(), placement only through buildPublishedWeekGrid(). No
 * service decision, status transition, read filter, Prisma transaction, validator
 * answer or grid calculation is mocked. Direct Prisma writes are fixture setup,
 * deliberate refusal-provoking state changes, or assertion reads — never presented
 * as publication-service proof. prisma/dev.db and prisma/walkthrough.db are never
 * opened, copied, migrated, reset, seeded, renamed or deleted; every client is
 * disconnected before only this invocation's directory is removed. Tags S01–S38
 * map to the task bundle's required scenarios.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient, type AuditLog, type Teaching, type TimetableEntry, type TimetableVersion, type Venue } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublishedWeekGrid, type PublishedWeekGrid } from "@/domain/publishedWeekGrid";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY } from "@/domain/policy";
import { performDraftPublish } from "@/server/draftPublish";
import type { DraftPublishResult, DraftPublishStore } from "@/server/draftPublishContract";
import { createDraftPublishStore } from "@/server/draftPublishStorePrisma";
import { readPublishedTimetable } from "@/server/publishedTimetable";
import type { DisplayableEntry, PublishedTimetableResult, PublishedTimetableStore } from "@/server/publishedTimetableContract";
import { createPublishedTimetableStore } from "@/server/publishedTimetableStorePrisma";

// Disposable database — M4-T4-P0 isolation standard.
type TempDb = { client: PrismaClient; dir: string; filePath: string; url: string };

function makeTempDb(prefix: string): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tams-${prefix}-`));
  const filePath = path.join(dir, "timetable.db");
  if (fs.existsSync(filePath)) throw new Error(`refusing to overwrite existing temp database ${filePath}`);
  const url = `file:${filePath.replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 60000 });
  return { client: new PrismaClient({ datasources: { db: { url } } }), dir, filePath, url };
}

async function disposeTempDb(db: TempDb): Promise<void> {
  await db.client.$disconnect();
  fs.rmSync(db.dir, { recursive: true, force: true });
}

// Synthetic fixture identifiers. No production seed data is read or changed.
const DEPT = "dept-life", GRP_A = "grp-alpha", GRP_B = "grp-beta", LECT_A = "lect-alpha", LECT_B = "lect-beta";
const ROOM = "venue-life-room", HALL = "venue-life-hall", LAB = "venue-life-lab";
const T_A101 = "teach-alpha-101", T_B102 = "teach-beta-102", T_A102 = "teach-alpha-102", T_B201 = "teach-beta-201", T_A201 = "teach-alpha-201";
const T_ORPHAN = "teach-orphan-101";
const OLD_PUB = "ver-life-s1-old", HIST = "ver-life-s1-hist", DRAFT_S1 = "ver-life-s1-draft", ALT_S1 = "ver-life-s1-alt";
const ORPHAN_DRAFT = "ver-life-s1-orphan";
const PUB_S2 = "ver-life-s2-pub", DRAFT_S2 = "ver-life-s2-draft";
const CLOCK = new Date("2026-03-01T09:00:00.000Z"), OLD_AT = new Date("2026-01-05T08:00:00.000Z");
const HIST_AT = new Date("2025-12-01T08:00:00.000Z"), S2_AT = new Date("2026-01-06T08:00:00.000Z");
const clock = () => CLOCK;
const OFFICER: Actor = { id: "user-life-officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const STUDENT: Actor = { id: "user-life-student", role: "STUDENT", departmentId: DEPT, studentGroupId: GRP_A };
const LECTURER: Actor = { id: "user-life-lect-a", role: "LECTURER", departmentId: DEPT, studentGroupId: null };
const ADMIN: Actor = { id: "user-life-admin", role: "ADMIN", departmentId: null, studentGroupId: null };

const UNITS: readonly [string, string, string, number, string][] = [
  ["unit-life-a", "DEMO-LIFE101", "Lifecycle Foundations (sample)", 1, "ROOM"],
  ["unit-life-b", "DEMO-LIFE102", "Lifecycle Systems (sample)", 1, "HALL"],
  ["unit-life-c", "DEMO-LIFE201", "Lifecycle Applications (sample)", 2, "ROOM"],
];
const TEACHINGS: readonly [string, string, string, string, number][] = [
  [T_A101, "unit-life-a", LECT_A, GRP_A, 40], [T_B102, "unit-life-b", LECT_B, GRP_B, 30],
  [T_A102, "unit-life-b", LECT_B, GRP_A, 40], [T_B201, "unit-life-c", LECT_A, GRP_B, 30],
  [T_A201, "unit-life-c", LECT_B, GRP_A, 40],
  // Referenced only by ORPHAN_DRAFT, so corrupting it cannot break a published read.
  [T_ORPHAN, "unit-life-a", LECT_A, GRP_A, 40],
];
const ENTRIES: readonly [string, string, string, string, string, string, string][] = [
  ["e-old-1", OLD_PUB, T_A101, ROOM, "MON", "08:00", "09:00"],
  ["e-old-2", OLD_PUB, T_B102, HALL, "TUE", "09:00", "11:00"],
  ["e-old-3", OLD_PUB, T_A102, HALL, "WED", "10:00", "11:00"],
  ["e-hist-1", HIST, T_A101, ROOM, "FRI", "10:00", "11:00"],
  ["e-hist-2", HIST, T_B102, HALL, "THU", "14:00", "15:00"],
  ["e-new-1", DRAFT_S1, T_A101, ROOM, "MON", "10:00", "11:00"],
  ["e-new-2", DRAFT_S1, T_B102, HALL, "TUE", "09:00", "11:00"],
  ["e-new-3", DRAFT_S1, T_A102, HALL, "WED", "14:00", "16:00"],
  ["e-new-4", DRAFT_S1, T_A101, ROOM, "THU", "08:00", "09:00"],
  ["e-alt-1", ALT_S1, T_A101, ROOM, "FRI", "08:00", "09:00"],
  ["e-s2-1", PUB_S2, T_B201, ROOM, "THU", "09:00", "10:00"],
  ["e-s2-2", PUB_S2, T_A201, ROOM, "MON", "11:00", "12:00"],
  ["e-s2n-1", DRAFT_S2, T_B201, ROOM, "TUE", "14:00", "15:00"],
  ["e-s2n-2", DRAFT_S2, T_A201, ROOM, "FRI", "10:00", "11:00"],
  ["e-orphan-1", ORPHAN_DRAFT, T_ORPHAN, ROOM, "MON", "12:00", "13:00"],
];

async function seedFixture(c: PrismaClient): Promise<void> {
  await c.auditLog.deleteMany(); await c.timetableEntry.deleteMany(); await c.venueUnavailable.deleteMany();
  await c.lecturerAvailability.deleteMany(); await c.timetableVersion.deleteMany(); await c.teaching.deleteMany();
  await c.venue.deleteMany(); await c.unit.deleteMany(); await c.lecturer.deleteMany();
  await c.user.deleteMany(); await c.studentGroup.deleteMany(); await c.department.deleteMany();
  await c.department.create({ data: { id: DEPT, name: "Lifecycle Dept (sample)", schoolId: "SIST" } });
  await c.studentGroup.createMany({ data: [
    { id: GRP_A, name: "ALPHA-Y3 (sample)", size: 40, departmentId: DEPT },
    { id: GRP_B, name: "BETA-Y2 (sample)", size: 30, departmentId: DEPT },
  ] });
  await c.user.createMany({ data: [
    { id: OFFICER.id, name: "Officer (sample)", email: "officer@life.tams.test", passwordHash: "test-placeholder", role: "OFFICER" },
    { id: LECTURER.id, name: "Lecturer Alpha (sample)", email: "lect-a@life.tams.test", passwordHash: "test-placeholder", role: "LECTURER", departmentId: DEPT },
    { id: "user-life-lect-b", name: "Lecturer Beta (sample)", email: "lect-b@life.tams.test", passwordHash: "test-placeholder", role: "LECTURER", departmentId: DEPT },
    { id: STUDENT.id, name: "Student (sample)", email: "student@life.tams.test", passwordHash: "test-placeholder", role: "STUDENT", departmentId: DEPT, studentGroupId: GRP_A },
    { id: ADMIN.id, name: "Admin (sample)", email: "admin@life.tams.test", passwordHash: "test-placeholder", role: "ADMIN" },
  ] });
  await c.lecturer.createMany({ data: [
    { id: LECT_A, userId: LECTURER.id, departmentId: DEPT }, { id: LECT_B, userId: "user-life-lect-b", departmentId: DEPT },
  ] });
  await c.unit.createMany({ data: UNITS.map(([id, code, title, semester, venueTypeRequired]) =>
    ({ id, code, title, semester, venueTypeRequired, departmentId: DEPT, hoursPerWeek: 3, scheduled: true })) });
  await c.teaching.createMany({ data: TEACHINGS.map(([id, unitId, lecturerId, groupId, expectedSize]) =>
    ({ id, unitId, lecturerId, groupId, expectedSize, sessionsPerWeek: 2, sessionLength: 60 })) });
  await c.venue.createMany({ data: [
    { id: ROOM, code: "LCR1", type: "ROOM", capacity: 60, ownerDepartmentId: DEPT, facilities: "[]", status: "ACTIVE" },
    { id: HALL, code: "LCH1", type: "HALL", capacity: 120, ownerDepartmentId: DEPT, facilities: "[]", status: "ACTIVE" },
    { id: LAB, code: "LCL1", type: "LAB", capacity: 40, ownerDepartmentId: DEPT, facilities: "[]", status: "ACTIVE" },
  ] });
  await c.timetableVersion.createMany({ data: [
    { id: OLD_PUB, semester: 1, status: "PUBLISHED", createdBy: OFFICER.id, publishedAt: OLD_AT },
    { id: HIST, semester: 1, status: "ARCHIVED", createdBy: OFFICER.id, publishedAt: HIST_AT },
    { id: DRAFT_S1, semester: 1, status: "DRAFT", createdBy: OFFICER.id, publishedAt: null },
    { id: ALT_S1, semester: 1, status: "DRAFT", createdBy: OFFICER.id, publishedAt: null },
    { id: ORPHAN_DRAFT, semester: 1, status: "DRAFT", createdBy: OFFICER.id, publishedAt: null },
    { id: PUB_S2, semester: 2, status: "PUBLISHED", createdBy: OFFICER.id, publishedAt: S2_AT },
    { id: DRAFT_S2, semester: 2, status: "DRAFT", createdBy: OFFICER.id, publishedAt: null },
  ] });
  await c.timetableEntry.createMany({ data: ENTRIES.map(([id, versionId, teachingId, venueId, day, start, end]) =>
    ({ id, versionId, teachingId, venueId, day, start, end, locked: false })) });
  await c.lecturerAvailability.createMany({ data: [
    { id: "la-alpha-block", lecturerId: LECT_A, day: "MON", start: "15:00", end: "17:00", available: false },
    { id: "la-alpha-open", lecturerId: LECT_A, day: "TUE", start: "09:00", end: "11:00", available: true },
  ] });
  await c.venueUnavailable.createMany({ data: [
    { id: "vu-hall-fri", venueId: HALL, day: "FRI", start: "14:00", end: "17:00", reason: null },
    { id: "vu-room-wed", venueId: ROOM, day: "WED", start: "12:00", end: "13:00", reason: "Sample maintenance" },
  ] });
}

// Assertion helpers.
type StateSnapshot = { versions: TimetableVersion[]; entries: TimetableEntry[]; audits: AuditLog[]; teachings: Teaching[]; venues: Venue[] };

async function stateSnapshot(c: PrismaClient): Promise<StateSnapshot> {
  const order = { orderBy: { id: "asc" as const } };
  return {
    versions: await c.timetableVersion.findMany(order), entries: await c.timetableEntry.findMany(order),
    audits: await c.auditLog.findMany(order), teachings: await c.teaching.findMany(order), venues: await c.venue.findMany(order),
  };
}

function ids(rows: readonly { id: string }[]): string[] { return rows.map((row) => row.id).sort(); }

function okPublish(result: DraftPublishResult): Extract<DraftPublishResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected publication success, got ${JSON.stringify(result)}`);
  return result;
}

function okRead(result: PublishedTimetableResult): Extract<PublishedTimetableResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected read success, got ${JSON.stringify(result)}`);
  return result;
}

function okGrid(entries: readonly DisplayableEntry[]): PublishedWeekGrid {
  const built = buildPublishedWeekGrid(entries, DEFAULT_POLICY);
  if (!built.ok) throw new Error(`expected renderable grid, got ${JSON.stringify(built)}`);
  return built.grid;
}

/** Whole-state equality: no transition, no audit, no entry or validation-context rewrite. */
async function expectRefused<K extends Exclude<DraftPublishResult, { ok: true }>["kind"]>(
  result: DraftPublishResult, kind: K, before: StateSnapshot,
): Promise<Extract<DraftPublishResult, { ok: false; kind: K }>> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  expect(result.kind).toBe(kind);
  expect(await stateSnapshot(client)).toEqual(before);
  if (result.kind !== kind) throw new Error(`expected ${kind}, got ${result.kind}`);
  return result as Extract<DraftPublishResult, { ok: false; kind: K }>;
}

async function expectStillOldPublication(): Promise<void> {
  const read = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
  expect(read.version.id).toBe(OLD_PUB);
  expect(ids(read.entries)).toEqual(["e-old-1", "e-old-3"]);
}

function publishIntervention(store: DraftPublishStore, intervene: () => Promise<unknown>): DraftPublishStore {
  return { ...store, publishDraft: async (input) => { await intervene(); return store.publishDraft(input); } };
}

function readIntervention(store: PublishedTimetableStore, intervene: () => Promise<unknown>): PublishedTimetableStore {
  return { ...store, readPublishedEntries: async (versionId, semester) => { await intervene(); return store.readPublishedEntries(versionId, semester); } };
}

function countedReadStore(store: PublishedTimetableStore): { store: PublishedTimetableStore; calls: string[] } {
  const calls: string[] = [];
  const track = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => { calls.push(name); return fn(...args); };
  return { calls, store: {
    listPublishedVersionsBySemester: track("versions", store.listPublishedVersionsBySemester),
    readPublishedEntries: track("entries", store.readPublishedEntries),
    listStudentGroups: track("groups", store.listStudentGroups), listLecturers: track("lecturers", store.listLecturers),
    findLecturerByUserId: track("lecturer", store.findLecturerByUserId), listVenues: track("venues", store.listVenues),
  } };
}

/** Test-layer failure injection only: production services gain no hook. */
function failingReadStore(store: PublishedTimetableStore, method: "versions" | "entries", message: string): PublishedTimetableStore {
  const fail = async (): Promise<never> => { throw new Error(message); };
  return method === "versions" ? { ...store, listPublishedVersionsBySemester: fail } : { ...store, readPublishedEntries: fail };
}

/**
 * Deliberate fixture corruption for INCOMPLETE_VALIDATION. SQLite enforces
 * ON DELETE RESTRICT on TimetableEntry.teachingId, so a referenced Teaching cannot
 * be removed by an ordinary Prisma delete. A dedicated single connection to THIS
 * disposable database turns foreign keys off, deletes the row, and reads the pragma
 * back so a pooled-connection mismatch fails loudly instead of silently passing.
 * No schema, migration or production code changes.
 */
async function breakTeachingReference(teachingId: string): Promise<void> {
  const breaker = new PrismaClient({ datasources: { db: { url: `${db.url}?connection_limit=1` } } });
  try {
    await breaker.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    const pragma = await breaker.$queryRawUnsafe<{ foreign_keys: number | bigint }[]>("PRAGMA foreign_keys");
    expect(Number(pragma[0].foreign_keys)).toBe(0);
    await breaker.$executeRawUnsafe('DELETE FROM "Teaching" WHERE "id" = ?', teachingId);
  } finally { await breaker.$disconnect(); }
  expect(await client.teaching.findUnique({ where: { id: teachingId } })).toBeNull();
  expect(await client.timetableEntry.count({ where: { teachingId } })).toBeGreaterThan(0);
}

let db: TempDb;
let client: PrismaClient;
let publishStore: DraftPublishStore;
let readStore: PublishedTimetableStore;

describe("published timetable lifecycle on one disposable SQLite database", () => {
  beforeAll(() => {
    db = makeTempDb("m4t4f-life");
    client = db.client;
    publishStore = createDraftPublishStore(client);
    readStore = createPublishedTimetableStore(client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    console.info(`[M4-T4f] disposable database: ${db.filePath}`);
  }, 60000);

  beforeEach(async () => { vi.mocked(console.error).mockClear(); await seedFixture(client); });

  afterAll(async () => {
    vi.restoreAllMocks();
    const dir = db.dir;
    await disposeTempDb(db);
    console.info(`[M4-T4f] cleanup removed ${dir}: ${!fs.existsSync(dir)}`);
  });

  it("S01 baseline resolves the earlier semester-1 PUBLISHED version, not the draft or archive", async () => {
    const read = okRead(await readPublishedTimetable(readStore, STUDENT, {}));
    expect(read.version).toEqual({ id: OLD_PUB, semester: 1, publishedAt: OLD_AT });
    expect(read.semester).toBe(1);
    expect(read.view).toBe("group");
    expect(read.selectionId).toBe(GRP_A);
    expect(await client.timetableVersion.findUnique({ where: { id: DRAFT_S1 } })).toMatchObject({ status: "DRAFT", publishedAt: null });
  });

  it("S02 baseline student default shows only their own group's stored sessions", async () => {
    const read = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    expect(read.selectionId).toBe(GRP_A);
    expect(ids(read.entries)).toEqual(["e-old-1", "e-old-3"]);
    expect(read.entries[0]).toMatchObject({
      day: "MON", start: "08:00", end: "09:00", unitCode: "DEMO-LIFE101", unitTitle: "Lifecycle Foundations (sample)",
      groupName: "ALPHA-Y3 (sample)", lecturerName: "Lecturer Alpha (sample)", venueCode: "LCR1", versionId: OLD_PUB,
    });
    expect(read.entries.every((entry) => entry.groupId === GRP_A)).toBe(true);
  });

  it("S03 baseline lecturer default resolves the linked lecturer record and their sessions", async () => {
    const read = okRead(await readPublishedTimetable(readStore, LECTURER, { semester: 1 }));
    expect(read.view).toBe("lecturer");
    expect(read.selectionId).toBe(LECT_A);
    expect(ids(read.entries)).toEqual(["e-old-1"]);
    expect(read.entries[0]).toMatchObject({ start: "08:00", end: "09:00", lecturerId: LECT_A, lecturerName: "Lecturer Alpha (sample)" });
  });

  it("S04 baseline officer default selects a real group rather than inventing one", async () => {
    const read = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1 }));
    expect(read.view).toBe("group");
    expect(read.selectionId).toBe(GRP_A);
    expect(ids(read.entries)).toEqual(["e-old-1", "e-old-3"]);
  });

  it("S05 baseline venue projection keeps a two-hour session and reports an unused venue as empty success", async () => {
    const hall = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1, view: "venue", id: HALL }));
    expect(ids(hall.entries)).toEqual(["e-old-2", "e-old-3"]);
    expect(hall.entries[0]).toMatchObject({ day: "TUE", start: "09:00", end: "11:00", venueCode: "LCH1", groupName: "BETA-Y2 (sample)" });
    const twoHour = okGrid(hall.entries).sessions.find((session) => session.entryId === "e-old-2");
    expect(twoHour).toMatchObject({ dayIndex: 1, startSlotIndex: 1, endSlotIndex: 3, slotSpan: 2, durationMinutes: 120 });
    const room = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1, view: "venue", id: ROOM }));
    expect(ids(room.entries)).toEqual(["e-old-1"]);
    const lab = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1, view: "venue", id: LAB }));
    expect(lab.entries).toEqual([]);
    expect(lab.version.id).toBe(OLD_PUB);
  });

  it("S06,S07,S08,S09,S10,S11 real publication commits the target, the injected clock, the archive and the audit", async () => {
    const before = await stateSnapshot(client);
    const result = okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    expect(result).toEqual({ ok: true, versionId: DRAFT_S1, semester: 1, archivedVersionIds: [OLD_PUB], publishedAt: CLOCK });
    const stored = await client.timetableVersion.findMany({ orderBy: { id: "asc" } });
    expect(stored.find((row) => row.id === DRAFT_S1)).toMatchObject({ status: "PUBLISHED", semester: 1, publishedAt: CLOCK });
    expect(stored.find((row) => row.id === OLD_PUB)).toMatchObject({ status: "ARCHIVED", publishedAt: OLD_AT });
    expect(stored.find((row) => row.id === HIST)).toMatchObject({ status: "ARCHIVED", publishedAt: HIST_AT });
    expect(stored.find((row) => row.id === PUB_S2)).toMatchObject({ status: "PUBLISHED", semester: 2, publishedAt: S2_AT });
    expect(stored.find((row) => row.id === ALT_S1)).toMatchObject({ status: "DRAFT", publishedAt: null });
    expect(stored.find((row) => row.id === DRAFT_S2)).toMatchObject({ status: "DRAFT", publishedAt: null });
    const audits = await client.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: OFFICER.id, action: "TIMETABLE_PUBLISH", entity: "TimetableVersion", entityId: DRAFT_S1,
      reason: `Published 4 entries of draft ${DRAFT_S1} (semester 1); archived ${OLD_PUB}.`,
    });
    const after = await stateSnapshot(client);
    expect(after.teachings).toEqual(before.teachings);
    expect(after.venues).toEqual(before.venues);
    expect(ids(after.entries)).toEqual(ids(before.entries));
    expect(after.entries.filter((row) => row.versionId === PUB_S2)).toEqual(before.entries.filter((row) => row.versionId === PUB_S2));
  });

  it("S12,S13 publication rewrites no entry: new draft rows and archived rows stay byte-identical", async () => {
    const before = await client.timetableEntry.findMany({ orderBy: { id: "asc" } });
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    const after = await client.timetableEntry.findMany({ orderBy: { id: "asc" } });
    expect(after).toEqual(before);
    expect(after.filter((row) => row.versionId === DRAFT_S1).map((row) => row.id)).toEqual(["e-new-1", "e-new-2", "e-new-3", "e-new-4"]);
    expect(after.filter((row) => row.versionId === OLD_PUB).map((row) => row.id)).toEqual(["e-old-1", "e-old-2", "e-old-3"]);
    expect(after.filter((row) => row.versionId === HIST).map((row) => row.id)).toEqual(["e-hist-1", "e-hist-2"]);
  });

  it("S14,S15,S16 all three role defaults read the newly published version after the real publication", async () => {
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    const student = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    const lecturer = okRead(await readPublishedTimetable(readStore, LECTURER, { semester: 1 }));
    const officer = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1 }));
    for (const read of [student, lecturer, officer]) expect(read.version).toEqual({ id: DRAFT_S1, semester: 1, publishedAt: CLOCK });
    expect(student.selectionId).toBe(GRP_A);
    expect(ids(student.entries)).toEqual(["e-new-1", "e-new-3", "e-new-4"]);
    expect(lecturer.selectionId).toBe(LECT_A);
    expect(ids(lecturer.entries)).toEqual(["e-new-1", "e-new-4"]);
    expect(officer.selectionId).toBe(GRP_A);
    expect(ids(officer.entries)).toEqual(["e-new-1", "e-new-3", "e-new-4"]);
    expect(student.entries[0]).toMatchObject({
      day: "MON", start: "10:00", end: "11:00", unitCode: "DEMO-LIFE101",
      groupName: "ALPHA-Y3 (sample)", lecturerName: "Lecturer Alpha (sample)", venueCode: "LCR1",
    });
  });

  it("S17,S18,S19,S20 explicit views filter the new version with no archived or cross-perspective leakage", async () => {
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    const group = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1, view: "group", id: GRP_B }));
    expect(ids(group.entries)).toEqual(["e-new-2"]);
    expect(group.entries[0]).toMatchObject({ groupName: "BETA-Y2 (sample)", lecturerName: "Lecturer Beta (sample)", venueCode: "LCH1" });
    const lecturer = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1, view: "lecturer", id: LECT_B }));
    expect(ids(lecturer.entries)).toEqual(["e-new-2", "e-new-3"]);
    expect(lecturer.entries.every((entry) => entry.lecturerId === LECT_B)).toBe(true);
    const venue = okRead(await readPublishedTimetable(readStore, LECTURER, { semester: 1, view: "venue", id: HALL }));
    expect(ids(venue.entries)).toEqual(["e-new-2", "e-new-3"]);
    expect(venue.entries.every((entry) => entry.venueId === HALL)).toBe(true);
    const archivedIds = ["e-old-1", "e-old-2", "e-old-3", "e-hist-1", "e-hist-2"];
    for (const read of [group, lecturer, venue]) {
      expect(read.version.id).toBe(DRAFT_S1);
      expect(read.entries.every((entry) => entry.versionId === DRAFT_S1)).toBe(true);
      expect(read.entries.some((entry) => archivedIds.includes(entry.id))).toBe(false);
    }
    expect(await readStore.readPublishedEntries(OLD_PUB, 1)).toEqual({ status: "stale" });
    expect(await readStore.readPublishedEntries(HIST, 1)).toEqual({ status: "stale" });
  });

  it("S21,S22,S23 the grid places published sessions by day and hour, keeps a two-hour block and matches the entry count", async () => {
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    const read = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    const grid = okGrid(read.entries);
    expect(grid.days.map((day) => day.day)).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(grid.slots).toHaveLength(9);
    expect(grid.slots[5]).toMatchObject({ start: "13:00", end: "14:00", isLunch: true });
    expect(grid.slotDurationMinutes).toBe(60);
    expect(grid.hasOverlaps).toBe(false);
    expect(grid.sessions).toHaveLength(read.entries.length);
    expect(grid.sessions.map((session) => session.entryId).sort()).toEqual(ids(read.entries));
    expect(grid.sessions.find((session) => session.entryId === "e-new-1")).toMatchObject({
      day: "MON", dayIndex: 0, start: "10:00", end: "11:00", startSlotIndex: 2, endSlotIndex: 3, slotSpan: 1,
      durationMinutes: 60, lane: 0, laneCount: 1, overlappingEntryIds: [], unitCode: "DEMO-LIFE101",
      unitTitle: "Lifecycle Foundations (sample)", groupName: "ALPHA-Y3 (sample)",
      lecturerName: "Lecturer Alpha (sample)", venueCode: "LCR1", versionId: DRAFT_S1,
    });
    expect(grid.sessions.find((session) => session.entryId === "e-new-3")).toMatchObject({
      day: "WED", dayIndex: 2, start: "14:00", end: "16:00", startSlotIndex: 6, endSlotIndex: 8,
      slotSpan: 2, durationMinutes: 120, unitCode: "DEMO-LIFE102", venueCode: "LCH1",
    });
    expect(grid.sessions.find((session) => session.entryId === "e-new-4")).toMatchObject({ day: "THU", dayIndex: 3, startSlotIndex: 0, endSlotIndex: 1, durationMinutes: 60 });
    // A renderable grid is not an M3 conflict-free certificate; the validator decides that.
    expect(read.entries).toHaveLength(3);
  });

  it("S24 a hard violation introduced into the draft refuses publication and commits nothing", async () => {
    await client.timetableEntry.update({ where: { id: "e-new-4" }, data: { day: "MON", start: "10:00", end: "11:00" } });
    const before = await stateSnapshot(client);
    const refused = await expectRefused(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock), "HARD_VIOLATIONS", before);
    expect(refused.versionId).toBe(DRAFT_S1);
    expect(refused.violations.map((violation) => violation.type).sort()).toEqual(["GROUP_OVERLAP", "LECTURER_OVERLAP", "VENUE_OVERLAP"]);
    expect(refused.violations.every((violation) => violation.message.length > 0)).toBe(true);
    await expectStillOldPublication();
  });

  it("S25 missing validation context refuses as INCOMPLETE_VALIDATION even with an empty violations list", async () => {
    await breakTeachingReference(T_ORPHAN);
    const before = await stateSnapshot(client);
    const refused = await expectRefused(await performDraftPublish(publishStore, OFFICER, { versionId: ORPHAN_DRAFT }, DEFAULT_POLICY, clock), "INCOMPLETE_VALIDATION", before);
    expect(refused.versionId).toBe(ORPHAN_DRAFT);
    expect(refused.violations).toEqual([]);
    expect(refused.missingContext).toEqual([
      expect.objectContaining({ kind: "MISSING_TEACHING", entryId: "e-orphan-1", refId: T_ORPHAN, entryIndex: 0 }),
    ]);
    expect(await client.timetableVersion.findUnique({ where: { id: ORPHAN_DRAFT } })).toMatchObject({ status: "DRAFT", publishedAt: null });
    await expectStillOldPublication();
  });

  it("S26 an empty draft is refused before any context read", async () => {
    await client.timetableEntry.deleteMany({ where: { versionId: DRAFT_S1 } });
    const before = await stateSnapshot(client);
    await expectRefused(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock), "EMPTY_DRAFT", before);
    await expectStillOldPublication();
  });

  it("S27 an already PUBLISHED or ARCHIVED target is refused as NOT_DRAFT and never re-stamped", async () => {
    const before = await stateSnapshot(client);
    const result = await performDraftPublish(publishStore, OFFICER, { versionId: OLD_PUB }, DEFAULT_POLICY, clock);
    await expectRefused(result, "NOT_DRAFT", before);
    expect(result).toMatchObject({ ok: false, versionId: OLD_PUB, storedStatus: "PUBLISHED" });
    const archived = await performDraftPublish(publishStore, OFFICER, { versionId: HIST }, DEFAULT_POLICY, clock);
    expect(archived).toMatchObject({ ok: false, kind: "NOT_DRAFT", storedStatus: "ARCHIVED" });
    expect(await stateSnapshot(client)).toEqual(before);
    await expectStillOldPublication();
  });

  it("S28 a missing target version is refused as VERSION_NOT_FOUND", async () => {
    const before = await stateSnapshot(client);
    const result = await performDraftPublish(publishStore, OFFICER, { versionId: "ver-life-missing" }, DEFAULT_POLICY, clock);
    await expectRefused(result, "VERSION_NOT_FOUND", before);
    expect(result).toMatchObject({ ok: false, versionId: "ver-life-missing" });
    await expectStillOldPublication();
  });

  it("S29a a draft entry changed after validation refuses as STALE/SNAPSHOT_CHANGED with nothing committed", async () => {
    const before = await stateSnapshot(client);
    const store = publishIntervention(publishStore, async () => {
      await client.timetableEntry.update({ where: { id: "e-new-1" }, data: { start: "11:00", end: "12:00" } });
    });
    const result = await performDraftPublish(store, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock);
    expect(result).toEqual({ ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" });
    const after = await stateSnapshot(client);
    expect(after.versions).toEqual(before.versions);
    expect(after.audits).toEqual(before.audits);
    expect(after.entries).not.toEqual(before.entries);
    expect(after.entries.find((row) => row.id === "e-new-1")).toMatchObject({ start: "11:00", end: "12:00", versionId: DRAFT_S1 });
    await expectStillOldPublication();
  });

  it("S29b a competing real publication before the commit refuses as STALE/PUBLISHED_SET_CHANGED", async () => {
    const store = publishIntervention(publishStore, async () => {
      okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: ALT_S1 }, DEFAULT_POLICY, clock));
    });
    const result = await performDraftPublish(store, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock);
    expect(result).toEqual({ ok: false, kind: "STALE", reason: "PUBLISHED_SET_CHANGED" });
    expect(await client.timetableVersion.findUnique({ where: { id: DRAFT_S1 } })).toMatchObject({ status: "DRAFT", publishedAt: null });
    expect(await client.timetableVersion.findUnique({ where: { id: ALT_S1 } })).toMatchObject({ status: "PUBLISHED", publishedAt: CLOCK });
    expect(await client.timetableVersion.findUnique({ where: { id: OLD_PUB } })).toMatchObject({ status: "ARCHIVED" });
    const audits = await client.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(ALT_S1);
    const read = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    expect(read.version.id).toBe(ALT_S1);
    expect(ids(read.entries)).toEqual(["e-alt-1"]);
  });

  it("S30 an unauthorized, signed-out or forged caller is refused before a single store operation", async () => {
    const before = await stateSnapshot(client);
    const counted = countedReadStore(readStore);
    expect(await performDraftPublish(publishStore, ADMIN, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock)).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(await performDraftPublish(publishStore, null, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock)).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    const forged = { versionId: DRAFT_S1, status: "PUBLISHED" } as { versionId: string };
    expect(await performDraftPublish(publishStore, OFFICER, forged, DEFAULT_POLICY, clock)).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(await readPublishedTimetable(counted.store, null, { semester: 1 })).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(counted.calls).toEqual([]);
    expect(await stateSnapshot(client)).toEqual(before);
    await expectStillOldPublication();
  });

  it("S31 refusals write no audit row and leave the current publication readable", async () => {
    const before = await stateSnapshot(client);
    const attempts = [
      await performDraftPublish(publishStore, ADMIN, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock),
      await performDraftPublish(publishStore, OFFICER, { versionId: "ver-life-missing" }, DEFAULT_POLICY, clock),
      await performDraftPublish(publishStore, OFFICER, { versionId: OLD_PUB }, DEFAULT_POLICY, clock),
      await performDraftPublish(publishStore, OFFICER, { versionId: HIST }, DEFAULT_POLICY, clock),
    ];
    expect(attempts.map((attempt) => attempt.ok)).toEqual([false, false, false, false]);
    expect(await client.auditLog.count()).toBe(0);
    expect(await stateSnapshot(client)).toEqual(before);
    await expectStillOldPublication();
  });

  it("S32 no stored current publication is NO_PUBLISHED_VERSION, never an archived timetable", async () => {
    // Test-only fixture state change, not publication-service proof.
    await client.timetableVersion.update({ where: { id: OLD_PUB }, data: { status: "ARCHIVED" } });
    for (const actor of [STUDENT, LECTURER, OFFICER]) {
      expect(await readPublishedTimetable(readStore, actor, { semester: 1 })).toEqual({ ok: false, kind: "NO_PUBLISHED_VERSION", semester: 1 });
    }
    expect(await client.timetableEntry.count({ where: { versionId: OLD_PUB } })).toBe(3);
    expect(await client.auditLog.count()).toBe(0);
    expect(await client.timetableVersion.findUnique({ where: { id: DRAFT_S1 } })).toMatchObject({ status: "DRAFT" });
  });

  it("S33 two stored current publications are AMBIGUOUS_PUBLISHED_VERSION with no newest-or-first winner", async () => {
    await client.timetableVersion.create({ data: {
      id: "ver-life-s1-aaa", semester: 1, status: "PUBLISHED", createdBy: OFFICER.id, publishedAt: new Date("2026-02-01T08:00:00.000Z"),
    } });
    expect(await readStore.listPublishedVersionsBySemester(1)).toHaveLength(2);
    for (const actor of [STUDENT, LECTURER, OFFICER]) {
      expect(await readPublishedTimetable(readStore, actor, { semester: 1 })).toEqual({ ok: false, kind: "AMBIGUOUS_PUBLISHED_VERSION", semester: 1 });
    }
    expect(await readPublishedTimetable(readStore, STUDENT, { semester: 1, view: "venue", id: ROOM })).toEqual({ ok: false, kind: "AMBIGUOUS_PUBLISHED_VERSION", semester: 1 });
    const semester2 = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 2, view: "venue", id: ROOM }));
    expect(semester2.version.id).toBe(PUB_S2);
    expect(ids(semester2.entries)).toEqual(["e-s2-1", "e-s2-2"]);
    expect(await client.auditLog.count()).toBe(0);
  });

  it("S34 semester isolation holds in both directions through two real publications", async () => {
    const semester2Before = await client.timetableVersion.findMany({ where: { semester: 2 }, orderBy: { id: "asc" } });
    const semester2EntriesBefore = await client.timetableEntry.findMany({ where: { versionId: { in: [PUB_S2, DRAFT_S2] } }, orderBy: { id: "asc" } });
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    expect(await client.timetableVersion.findMany({ where: { semester: 2 }, orderBy: { id: "asc" } })).toEqual(semester2Before);
    expect(await client.timetableEntry.findMany({ where: { versionId: { in: [PUB_S2, DRAFT_S2] } }, orderBy: { id: "asc" } })).toEqual(semester2EntriesBefore);
    const semester1AfterFirst = await client.timetableVersion.findMany({ where: { semester: 1 }, orderBy: { id: "asc" } });
    const second = okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S2 }, DEFAULT_POLICY, clock));
    expect(second).toMatchObject({ versionId: DRAFT_S2, semester: 2, archivedVersionIds: [PUB_S2], publishedAt: CLOCK });
    expect(await client.timetableVersion.findMany({ where: { semester: 1 }, orderBy: { id: "asc" } })).toEqual(semester1AfterFirst);
    expect(await client.timetableEntry.findMany({ where: { versionId: { in: [PUB_S2, DRAFT_S2] } }, orderBy: { id: "asc" } })).toEqual(semester2EntriesBefore);
    expect(await client.timetableVersion.findUnique({ where: { id: PUB_S2 } })).toMatchObject({ status: "ARCHIVED", publishedAt: S2_AT });
    expect(await client.timetableVersion.findUnique({ where: { id: DRAFT_S2 } })).toMatchObject({ status: "PUBLISHED", publishedAt: CLOCK });
    expect(await client.auditLog.count()).toBe(2);
    const read1 = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    expect(read1.version.id).toBe(DRAFT_S1);
    expect(ids(read1.entries)).toEqual(["e-new-1", "e-new-3", "e-new-4"]);
    const read2 = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 2, view: "group", id: GRP_B }));
    expect(read2.version).toEqual({ id: DRAFT_S2, semester: 2, publishedAt: CLOCK });
    expect(ids(read2.entries)).toEqual(["e-s2n-1"]);
    expect(await readPublishedTimetable(readStore, STUDENT, { semester: 2 })).toMatchObject({ ok: true, version: { id: DRAFT_S2 } });
  });

  it("S35 a committed publication between resolution and the entry read is STALE, via a second connection to the same database", async () => {
    const second = new PrismaClient({ datasources: { db: { url: db.url } } });
    try {
      const secondPublishStore = createDraftPublishStore(second);
      let intervened = false;
      const store = readIntervention(readStore, async () => {
        if (intervened) return;
        intervened = true;
        okPublish(await performDraftPublish(secondPublishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
      });
      // One sequential committed intervention, not a simultaneous-writer race.
      expect(await readPublishedTimetable(store, STUDENT, { semester: 1 })).toEqual({ ok: false, kind: "STALE", semester: 1 });
      const lecturerAfter = okRead(await readPublishedTimetable(store, LECTURER, { semester: 1 }));
      expect(lecturerAfter.version.id).toBe(DRAFT_S1);
      expect(ids(lecturerAfter.entries)).toEqual(["e-new-1", "e-new-4"]);
      const after = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
      expect(after.version.id).toBe(DRAFT_S1);
      expect(ids(after.entries)).toEqual(["e-new-1", "e-new-3", "e-new-4"]);
      expect(after.entries.some((entry) => entry.id.startsWith("e-old-"))).toBe(false);
      expect(await second.timetableVersion.findUnique({ where: { id: DRAFT_S1 } })).toMatchObject({ status: "PUBLISHED" });
      expect(await client.auditLog.count()).toBe(1);
    } finally { await second.$disconnect(); }
  });

  it("S36 an injected database read failure is INTERNAL_ERROR, never an empty success and never a leaked detail", async () => {
    const before = await stateSnapshot(client);
    for (const method of ["versions", "entries"] as const) {
      vi.mocked(console.error).mockClear();
      const store = failingReadStore(readStore, method, `SELECT * FROM TimetableEntry; postgres://tams:hunter2@db.internal:5432/tams; ${db.filePath}`);
      const result = await readPublishedTimetable(store, STUDENT, { semester: 1 });
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(JSON.stringify(result)).not.toMatch(/SELECT|hunter2|db\.internal|sqlite|prisma|timetable\.db/i);
      expect(vi.mocked(console.error).mock.calls).toEqual([["[publishedTimetable] read failed; returning INTERNAL_ERROR"]]);
    }
    expect(await stateSnapshot(client)).toEqual(before);
    await expectStillOldPublication();
  });

  it("S37 the read service performs no write of any kind", async () => {
    expect(Object.keys(readStore).sort()).toEqual([
      "findLecturerByUserId", "listLecturers", "listPublishedVersionsBySemester", "listStudentGroups", "listVenues", "readPublishedEntries",
    ]);
    const before = await stateSnapshot(client);
    for (const actor of [STUDENT, LECTURER, OFFICER]) {
      okRead(await readPublishedTimetable(readStore, actor, { semester: 1 }));
      okRead(await readPublishedTimetable(readStore, actor, { semester: 1, view: "venue", id: HALL }));
      okRead(await readPublishedTimetable(readStore, actor, { semester: 2, view: "group", id: GRP_A }));
    }
    expect(await readPublishedTimetable(readStore, STUDENT, { semester: 1, view: "group", id: "grp-missing" })).toMatchObject({ ok: false, kind: "SELECTION_NOT_FOUND" });
    expect(await stateSnapshot(client)).toEqual(before);
    expect(await client.auditLog.count()).toBe(0);
  });

  it("S38 both stores are bound to the exact same injected disposable database and agree on stored rows", async () => {
    expect(db.dir.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(db.filePath)).toBe(true);
    const rows = await client.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const files = rows.filter((row) => row.name === "main").map((row) => row.file.replace(/\\/g, "/").toLowerCase());
    expect(files).toEqual([db.filePath.replace(/\\/g, "/").toLowerCase()]);
    expect(files[0]).not.toContain("prisma/dev.db");
    expect(files[0]).not.toContain("prisma/walkthrough.db");
    const publishRows = await publishStore.listEntriesByVersion(OLD_PUB);
    const readRows = await readStore.readPublishedEntries(OLD_PUB, 1);
    expect(readRows.status).toBe("current");
    if (readRows.status !== "current") throw new Error("expected a current read");
    expect(ids(publishRows)).toEqual(ids(readRows.entries));
    expect(readRows.version).toEqual(await publishStore.findVersion(OLD_PUB));
    expect(await publishStore.listPublishedVersionsBySemester(1)).toEqual(await readStore.listPublishedVersionsBySemester(1));
    okPublish(await performDraftPublish(publishStore, OFFICER, { versionId: DRAFT_S1 }, DEFAULT_POLICY, clock));
    const alpha = okRead(await readPublishedTimetable(readStore, STUDENT, { semester: 1 }));
    const beta = okRead(await readPublishedTimetable(readStore, OFFICER, { semester: 1, view: "group", id: GRP_B }));
    expect(alpha.version.id).toBe(DRAFT_S1);
    expect(ids(await publishStore.listEntriesByVersion(DRAFT_S1))).toEqual(ids(alpha.entries.concat(beta.entries)));
  });
});
