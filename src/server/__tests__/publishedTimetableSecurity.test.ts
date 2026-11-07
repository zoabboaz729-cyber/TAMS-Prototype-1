/** Real multi-department SQLite authorization, including indirect disclosure.
 * Only this invocation's exclusive temporary directory is initialized/deleted. */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/domain/permissions";
import { readPublishedTimetable } from "@/server/publishedTimetable";
import { loadTimetableOptions } from "@/server/publishedTimetableOptions";
import { createPublishedTimetableStore } from "@/server/publishedTimetableStorePrisma";
import type { PublishedTimetableResult, PublishedTimetableStore } from "@/server/publishedTimetableContract";

const student: Actor = { id: "s1", role: "STUDENT", departmentId: "d1", studentGroupId: "g1" };
const lecturer: Actor = { id: "u1", role: "LECTURER", departmentId: "d2", studentGroupId: null };
const officer: Actor = { id: "officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const dept = (role: "DEPT_REP" | "APPROVER"): Actor => ({ id: role, role, departmentId: "d1", studentGroupId: null });
function ids(result: PublishedTimetableResult): string[] {
  if (!result.ok) throw new Error(`Expected timetable, got ${result.kind}`);
  return result.entries.map(e => e.id).sort();
}

describe("M4-T4h real SQLite timetable security", () => {
  let client: PrismaClient;
  let store: PublishedTimetableStore;
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tams-h-security-"));
    const file = path.join(dir, "security.db");
    expect(fs.existsSync(file)).toBe(false);
    const url = `file:${file}`;
    execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 60000 });
    client = new PrismaClient({ datasources: { db: { url } } });
    const databases = await client.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
    expect(databases.some(row => row.file === file)).toBe(true);
    await client.department.createMany({ data: [
      { id: "d1", name: "Department One (sample)", schoolId: "S" },
      { id: "d2", name: "Department Two (sample)", schoolId: "S" },
    ] });
    await client.studentGroup.createMany({ data: [
      { id: "g1", name: "Group One (sample)", size: 20, departmentId: "d1" },
      { id: "g2", name: "Group Two (sample)", size: 20, departmentId: "d2" },
      { id: "g3", name: "Untaught Group (sample)", size: 20, departmentId: "d2" },
    ] });
    await client.user.createMany({ data: [
      { id: officer.id, name: "Officer (sample)", email: "o@security.test", role: "OFFICER", passwordHash: "fixture" },
      { id: student.id, name: "Student (sample)", email: "s@security.test", role: "STUDENT", studentGroupId: "g1", departmentId: "d1", passwordHash: "fixture" },
      { id: lecturer.id, name: "External Lecturer (sample)", email: "l1@security.test", role: "LECTURER", departmentId: "d2", passwordHash: "fixture" },
      { id: "u2", name: "Other Lecturer (sample)", email: "l2@security.test", role: "LECTURER", departmentId: "d2", passwordHash: "fixture" },
    ] });
    await client.lecturer.createMany({ data: [
      { id: "l1", userId: "u1", departmentId: "d2" }, { id: "l2", userId: "u2", departmentId: "d2" },
    ] });
    await client.unit.createMany({ data: [1, 2].map(semester => ({ id: `unit${semester}`, code: `SAMPLE-${semester}`, title: "Security fixture (sample)", departmentId: "d2", semester, hoursPerWeek: 3, venueTypeRequired: "ROOM" })) });
    await client.teaching.createMany({ data: [
      { id: "t1", unitId: "unit1", groupId: "g1", lecturerId: "l1" },
      { id: "t2", unitId: "unit1", groupId: "g2", lecturerId: "l1" },
      { id: "t3", unitId: "unit1", groupId: "g1", lecturerId: "l2" },
      { id: "t4", unitId: "unit1", groupId: "g2", lecturerId: "l2" },
      { id: "t5", unitId: "unit2", groupId: "g3", lecturerId: "l1" },
    ].map(t => ({ ...t, expectedSize: 20, sessionsPerWeek: 1, sessionLength: 60 })) });
    await client.venue.create({ data: { id: "v1", code: "Sample Room", type: "ROOM", capacity: 40 } });
    await client.timetableVersion.createMany({ data: [
      { id: "pub1", semester: 1, status: "PUBLISHED", createdBy: officer.id, publishedAt: new Date("2026-11-07T10:00:00Z") },
      { id: "pub2", semester: 2, status: "PUBLISHED", createdBy: officer.id, publishedAt: new Date("2026-11-07T10:00:00Z") },
      { id: "draft", semester: 1, status: "DRAFT", createdBy: officer.id },
      { id: "archive", semester: 1, status: "ARCHIVED", createdBy: officer.id, publishedAt: new Date("2026-11-06T10:00:00Z") },
    ] });
    await client.timetableEntry.createMany({ data: [
      ...[1, 2, 3, 4].map(n => ({ id: `e${n}`, versionId: "pub1", teachingId: `t${n}`, venueId: "v1", day: "MON", start: `${n + 7}:00`.padStart(5, "0"), end: `${n + 8}:00`.padStart(5, "0") })),
      { id: "e5", versionId: "pub2", teachingId: "t5", venueId: "v1", day: "TUE", start: "08:00", end: "09:00" },
      { id: "hidden-draft", versionId: "draft", teachingId: "t1", venueId: "v1", day: "TUE", start: "08:00", end: "09:00" },
      { id: "hidden-archive", versionId: "archive", teachingId: "t1", venueId: "v1", day: "WED", start: "08:00", end: "09:00" },
    ] });
    store = createPublishedTimetableStore(client);
  }, 60000);
  afterAll(async () => {
    await client?.$disconnect();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
  const read = (actor: Actor | null, request: unknown = {}) => readPublishedTimetable(store, actor, request);

  it("student defaults and explicit own-group requests read only current own classes", async () => {
    expect(ids(await read(student))).toEqual(["e1", "e3"]);
    expect(ids(await read(student, { view: "group", id: "g1" }))).toEqual(["e1", "e3"]);
  });
  it.each([{ view: "group", id: "g2" }, { view: "lecturer", id: "l1" }, { view: "lecturer", id: "l2" }, { view: "venue", id: "v1" }])("student cannot forge $view/$id", async request => {
    expect(await read(student, request)).toEqual({ ok: false, kind: "FORBIDDEN" });
  });
  it("lecturer defaults and explicit own identity resolve via Lecturer.userId", async () => {
    expect(ids(await read(lecturer))).toEqual(["e1", "e2"]);
    expect(ids(await read(lecturer, { view: "lecturer", id: "l1" }))).toEqual(["e1", "e2"]);
  });
  it("lecturer group view contains only own teaching, even across departments", async () => {
    expect(ids(await read(lecturer, { view: "group", id: "g1" }))).toEqual(["e1"]);
    expect(ids(await read(lecturer, { view: "group", id: "g2" }))).toEqual(["e2"]);
  });
  it.each([{ view: "lecturer", id: "l2" }, { view: "venue", id: "v1" }, { view: "group", id: "g3" }])("lecturer cannot forge $view/$id in semester one", async request => {
    expect(await read(lecturer, request)).toEqual({ ok: false, kind: "FORBIDDEN" });
  });
  it("semester-specific teaching changes lecturer group choices", async () => {
    const first = await loadTimetableOptions(store, lecturer, 1);
    const second = await loadTimetableOptions(store, lecturer, 2);
    expect(first.groups.map(g => g.id)).toEqual(["g1", "g2"]);
    expect(second.groups.map(g => g.id)).toEqual(["g3"]);
    expect(ids(await read(lecturer, { semester: 2, view: "group", id: "g3" }))).toEqual(["e5"]);
    expect(await read(lecturer, { semester: 2, view: "group", id: "g1" })).toEqual({ ok: false, kind: "FORBIDDEN" });
  });
  it.each(["DEPT_REP", "APPROVER"] as const)("%s sees relevant external teaching but no other department sessions", async role => {
    expect(ids(await read(dept(role)))).toEqual(["e1", "e3"]);
    expect(ids(await read(dept(role), { view: "lecturer", id: "l1" }))).toEqual(["e1"]);
    expect(ids(await read(dept(role), { view: "lecturer", id: "l2" }))).toEqual(["e3"]);
    expect(await read(dept(role), { view: "group", id: "g2" })).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(await read(dept(role), { view: "venue", id: "v1" })).toEqual({ ok: false, kind: "FORBIDDEN" });
    const options = await loadTimetableOptions(store, dept(role), 1);
    expect(options.groups.map(g => g.id)).toEqual(["g1"]);
    expect(options.lecturers.map(l => l.id)).toEqual(["l1", "l2"]);
    expect(options.venues).toEqual([]);
    expect((await loadTimetableOptions(store, dept(role), 2)).lecturers).toEqual([]);
  });
  it.each(["OFFICER", "ADMIN"] as const)("%s retains full published views", async role => {
    const a = { ...officer, role };
    expect(ids(await read(a, { view: "group", id: "g2" }))).toEqual(["e2", "e4"]);
    expect(ids(await read(a, { view: "lecturer", id: "l1" }))).toEqual(["e1", "e2"]);
    expect(ids(await read(a, { view: "venue", id: "v1" }))).toEqual(["e1", "e2", "e3", "e4"]);
  });
  it("missing identity links cannot be bypassed with explicit known IDs", async () => {
    for (const [a, request] of [
      [{ ...student, studentGroupId: null }, { view: "group", id: "g1" }],
      [{ ...lecturer, id: "unlinked" }, { view: "lecturer", id: "l1" }],
      [{ ...dept("APPROVER"), departmentId: null }, { view: "group", id: "g1" }],
    ] as const) expect(await read(a, request)).toMatchObject({ ok: false, kind: "IDENTITY_UNRESOLVED" });
  });
  it("signed-out and request-forged identities never grant access", async () => {
    expect(await read(null)).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    for (const extra of [{ role: "OFFICER" }, { actor: officer }, { departmentId: "d2" }, { studentGroupId: "g2" }, { versionId: "archive" }]) {
      expect(await read(student, { ...extra, view: "group", id: "g2" })).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    }
  });
  it("permitted and forbidden reads leave entries, versions and audit records unchanged", async () => {
    const snapshot = async () => JSON.stringify([await client.timetableVersion.findMany({ orderBy: { id: "asc" } }), await client.timetableEntry.findMany({ orderBy: { id: "asc" } }), await client.auditLog.findMany()]);
    const before = await snapshot();
    await read(student);
    await read(lecturer, { view: "venue", id: "v1" });
    await read(dept("DEPT_REP"), { view: "lecturer", id: "l1" });
    expect(await snapshot()).toBe(before);
  });
});
