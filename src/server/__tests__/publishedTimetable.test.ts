/**
 * M4-T4a — the read-only published-timetable service, tested against an injected
 * fake store: no database, no Prisma, no writes. The fake counts every call and
 * mirrors the contract's one atomic consistency boundary (re-check the semester's
 * unique PUBLISHED version, then read its entries), can inject a competing
 * publication before that re-check, leak a foreign-version entry, and throw on any
 * method. Authorization runs through the real `decideAccess`, never a copied
 * matrix. Covers the bundle's 34 required scenarios.
 */
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/permissions";
import type { TimetableVersionStatus } from "@/domain/types";
import { readPublishedTimetable } from "@/server/publishedTimetable";
import type {
  DisplayableEntry, LecturerChoice, PublishedEntriesRead, PublishedEntryRow, PublishedTimetableResult,
  PublishedTimetableStore, PublishedVersionRow, StudentGroupChoice, VenueChoice,
} from "@/server/publishedTimetableContract";

// --- Fixtures -------------------------------------------------------------

const PUB = "ver-pub-s1";
const PUB_AT = new Date("2026-11-06T08:00:00.000Z");
const officer: Actor = { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const student = (groupId: string | null = "group-1"): Actor => ({ id: "user-student", role: "STUDENT", departmentId: null, studentGroupId: groupId });
const lecturer = (userId = "user-lect-A"): Actor => ({ id: userId, role: "LECTURER", departmentId: "dept-1", studentGroupId: null });
const allRoleActors: Actor[] = [
  { id: "user-admin", role: "ADMIN", departmentId: null, studentGroupId: null },
  { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null },
  { id: "user-rep", role: "DEPT_REP", departmentId: "dept-1", studentGroupId: null },
  { id: "user-approver", role: "APPROVER", departmentId: "dept-1", studentGroupId: null },
  { id: "user-lect-A", role: "LECTURER", departmentId: "dept-1", studentGroupId: null },
  { id: "user-student", role: "STUDENT", departmentId: null, studentGroupId: "group-1" },
];

const versionOf = (over: Partial<PublishedVersionRow> = {}): PublishedVersionRow => ({ id: PUB, semester: 1, status: "PUBLISHED", publishedAt: PUB_AT, ...over });
const entryOf = (id: string, over: Partial<PublishedEntryRow> = {}): PublishedEntryRow => ({
  id, versionId: PUB, teachingId: `t-${id}`, venueId: "v-1", day: "MON", start: "08:00", end: "09:00",
  unitCode: "SOEN 413", unitTitle: "Software Architecture", groupId: "group-1", groupName: "SE-Y4",
  lecturerId: "lect-A", lecturerName: "Lecturer A", venueCode: "CR1", ...over,
});

type FakeData = { versions: PublishedVersionRow[]; entries: PublishedEntryRow[]; groups: StudentGroupChoice[]; lecturers: LecturerChoice[]; venues: VenueChoice[] };

/** group-1:{e-1,e-3} group-2:{e-2,e-4} lect-A:{e-1,e-4} lect-B:{e-2,e-3} v-1:{e-1,e-3} v-2:{e-2,e-4}. */
const baseData = (): FakeData => ({
  versions: [versionOf(), versionOf({ id: "ver-pub-s2", semester: 2, publishedAt: new Date("2026-01-06T08:00:00.000Z") })],
  entries: [
    entryOf("e-1"),
    entryOf("e-2", { venueId: "v-2", day: "TUE", unitCode: "CS 201", unitTitle: "Data Structures", groupId: "group-2", groupName: "CS-Y2", lecturerId: "lect-B", lecturerName: "Lecturer B", venueCode: "CR2" }),
    entryOf("e-3", { venueId: "v-1", day: "WED", start: "10:00", end: "11:00", unitCode: "SOEN 415", unitTitle: "Interactive Design", lecturerId: "lect-B", lecturerName: "Lecturer B" }),
    entryOf("e-4", { venueId: "v-2", day: "MON", start: "10:00", end: "11:00", unitCode: "CS 202", unitTitle: "Algorithms", groupId: "group-2", groupName: "CS-Y2", venueCode: "CR2" }),
  ],
  groups: [{ id: "group-1", name: "SE-Y4", departmentId: "dept-1" }, { id: "group-2", name: "CS-Y2", departmentId: "dept-2" }],
  lecturers: [{ id: "lect-A", userId: "user-lect-A", displayName: "Lecturer A" }, { id: "lect-B", userId: "user-lect-B", displayName: "Lecturer B" }],
  venues: [{ id: "v-1", code: "CR1" }, { id: "v-2", code: "CR2" }],
});

// --- Fake store: the injected read-only PublishedTimetableStore ------------

type FakeOptions = { race?: (data: FakeData) => void; throwOn?: keyof PublishedTimetableStore; leakEntry?: PublishedEntryRow };
type FakeStore = PublishedTimetableStore & { calls: string[]; data: FakeData };
const READ_METHODS: (keyof PublishedTimetableStore)[] = ["listPublishedVersionsBySemester", "readPublishedEntries", "listStudentGroups", "listLecturers", "findLecturerByUserId", "listVenues", "listTeachingAccess"];

function fakeStore(build?: (data: FakeData) => void, options: FakeOptions = {}): FakeStore {
  const data = baseData();
  build?.(data);
  const store: FakeStore = {
    calls: [], data,
    listPublishedVersionsBySemester: async (semester) => { gate("listPublishedVersionsBySemester"); return data.versions.filter((v) => v.status === "PUBLISHED" && v.semester === semester); },
    readPublishedEntries: async (versionId, semester): Promise<PublishedEntriesRead> => {
      gate("readPublishedEntries");
      options.race?.(data);
      const current = data.versions.filter((v) => v.status === "PUBLISHED" && v.semester === semester && v.publishedAt !== null);
      if (current.length !== 1 || current[0].id !== versionId) return { status: "stale" };
      const entries = data.entries.filter((e) => e.versionId === versionId);
      return { status: "current", version: current[0], entries: options.leakEntry ? [...entries, options.leakEntry] : entries };
    },
    listTeachingAccess: async () => data.entries.filter(e => e.groupId !== null && e.lecturerId !== null).map(e => ({ groupId: e.groupId!, lecturerId: e.lecturerId! })),
    listStudentGroups: async () => { gate("listStudentGroups"); return data.groups; },
    listLecturers: async () => { gate("listLecturers"); return data.lecturers; },
    findLecturerByUserId: async (userId) => { gate("findLecturerByUserId"); return data.lecturers.find((l) => l.userId === userId) ?? null; },
    listVenues: async () => { gate("listVenues"); return data.venues; },
  };
  return store;
  function gate(name: keyof PublishedTimetableStore) { store.calls.push(name); if (options.throwOn === name) throw new Error("store down"); }
}

// --- Assertion helpers ----------------------------------------------------

const read = (store: FakeStore, actor: Actor | null, request: unknown) => readPublishedTimetable(store, actor, request);
const expectUntouched = (store: FakeStore) => expect(store.calls).toEqual([]);
const text = (s: string): string => expect.stringContaining(s) as unknown as string;
function ok(result: PublishedTimetableResult): { version: { id: string; semester: number; publishedAt: Date }; view: string; selectionId: string; semester: number; entries: DisplayableEntry[] } {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result;
}
const entryIds = (result: PublishedTimetableResult) => ok(result).entries.map((e) => e.id);

// --- 1, 2, 3: authorization before any read -------------------------------

describe("authorization", () => {
  it("refuses a missing session and forged identity keys with zero store operations", async () => {
    const anon = fakeStore();
    expect(await read(anon, null, {})).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectUntouched(anon);
    for (const forged of [{ versionId: PUB }, { role: "OFFICER", actorId: "attacker" }, { semester: 1, departmentId: "dept-1", privileges: "ALL" }]) {
      const store = fakeStore();
      expect(await read(store, officer, forged)).toEqual({ ok: false, kind: "INVALID_INPUT", message: text("only carry semester, view and id") });
      expectUntouched(store);
    }
  });

  it("permits all six accepted roles through the real decideAccess", async () => {
    for (const actor of allRoleActors) {
      const store = fakeStore();
      expect((await read(store, actor, {})).ok).toBe(true);
      expect(store.calls.length).toBeGreaterThan(0);
    }
  });

  it("fails closed for an unknown runtime role with zero store operations", async () => {
    const store = fakeStore();
    const unknown = { id: "user-x", role: "UNKNOWN", departmentId: null, studentGroupId: null } as unknown as Actor;
    expect(await read(store, unknown, {})).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectUntouched(store);
  });
});

// --- 4, 5, 6: the request is validated before the database ----------------

describe("request validation", () => {
  it("refuses an invalid semester before reading anything", async () => {
    for (const semester of [0, 3, 1.5, "1"]) {
      const store = fakeStore();
      expect(await read(store, officer, { semester })).toEqual({ ok: false, kind: "INVALID_INPUT", message: text("semester 1 or 2") });
      expectUntouched(store);
    }
  });
  it("refuses an unsupported perspective before reading anything", async () => {
    const store = fakeStore();
    expect(await read(store, officer, { view: "room", id: "v-1" })).toEqual({ ok: false, kind: "INVALID_INPUT", message: text("group, lecturer or venue") });
    expectUntouched(store);
  });
  it("refuses unknown request keys, including a versionId selector", async () => {
    for (const request of [{ versionId: PUB }, { view: "group", id: "group-1", extra: true }, { id: "group-1", actor: {} }]) {
      const store = fakeStore();
      expect(await read(store, officer, request)).toEqual({ ok: false, kind: "INVALID_INPUT", message: text("only carry semester, view and id") });
      expectUntouched(store);
    }
  });
});

// --- 7 through 12: role-aware defaults ------------------------------------

describe("role-aware defaults", () => {
  it("defaults a student to their own session group", async () => {
    const result = ok(await read(fakeStore(), student("group-1"), {}));
    expect([result.view, result.selectionId]).toEqual(["group", "group-1"]);
    expect(result.entries.every((e) => e.groupId === "group-1")).toBe(true);
    expect(result.entries.map((e) => e.id)).toEqual(["e-1", "e-3"]);
  });
  it("refuses a student with no linked group, and never selects another", async () => {
    const store = fakeStore();
    expect(await read(store, student(null), {})).toEqual({ ok: false, kind: "IDENTITY_UNRESOLVED", message: text("not linked to a student group") });
    expectUntouched(store);
    const gone = fakeStore();
    expect(await read(gone, student("group-ghost"), {})).toEqual({ ok: false, kind: "IDENTITY_UNRESOLVED", message: text("could not be found") });
  });
  it("defaults a lecturer to their own Lecturer record", async () => {
    const result = ok(await read(fakeStore(), lecturer("user-lect-A"), {}));
    expect([result.view, result.selectionId]).toEqual(["lecturer", "lect-A"]);
    expect(result.entries.map((e) => e.id)).toEqual(["e-1", "e-4"]);
  });
  it("refuses a lecturer with no matching Lecturer record", async () => {
    const store = fakeStore();
    expect(await read(store, lecturer("user-nobody"), {})).toEqual({ ok: false, kind: "IDENTITY_UNRESOLVED", message: text("not linked to a lecturer record") });
    expect(store.calls).toEqual(["listStudentGroups", "findLecturerByUserId"]);
  });
  it("gives an all-scope role a deterministic available group", async () => {
    const forward = ok(await read(fakeStore(), officer, {}));
    const reversed = ok(await read(fakeStore((d) => { d.groups = [{ id: "group-2", name: "CS-Y2", departmentId: "dept-2" }, { id: "group-1", name: "SE-Y4", departmentId: "dept-1" }]; }), officer, {}));
    expect([forward.view, forward.selectionId]).toEqual(["group", "group-1"]);
    expect(reversed.selectionId).toBe("group-1");
  });
  it("refuses an all-scope default when no group is available", async () => {
    const store = fakeStore((d) => { d.groups = []; });
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "SELECTION_REQUIRED", message: text("No student group is available") });
  });
});

// --- 13 through 17 and the view-without-id rule: explicit selection --------

describe("explicit selection", () => {
  it("resolves an explicit group, lecturer and venue view", async () => {
    expect(ok(await read(fakeStore(), officer, { view: "group", id: "group-2" })).selectionId).toBe("group-2");
    expect(entryIds(await read(fakeStore(), officer, { view: "lecturer", id: "lect-B" }))).toEqual(["e-2", "e-3"]);
    expect(entryIds(await read(fakeStore(), officer, { view: "venue", id: "v-2" }))).toEqual(["e-4", "e-2"]);
  });
  it("distinguishes a nonexistent selection from an existing one with no sessions", async () => {
    const missing = fakeStore();
    expect(await read(missing, officer, { view: "group", id: "ghost" })).toEqual({ ok: false, kind: "SELECTION_NOT_FOUND", view: "group", selectionId: "ghost" });
    expect(await read(fakeStore(), officer, { view: "venue", id: "ghost" })).toEqual({ ok: false, kind: "SELECTION_NOT_FOUND", view: "venue", selectionId: "ghost" });
    const empty = fakeStore((d) => { d.groups = [...d.groups, { id: "group-empty", name: "EMPTY" }]; });
    const result = ok(await read(empty, officer, { view: "group", id: "group-empty" }));
    expect(result.entries).toEqual([]);
    expect(result.selectionId).toBe("group-empty");
  });
  it("asks for a selection when a view is named without an id, never substituting another view", async () => {
    const store = fakeStore();
    expect(await read(store, officer, { view: "venue" })).toEqual({ ok: false, kind: "SELECTION_REQUIRED", message: text("Choose a specific venue") });
    expect(await read(fakeStore(), officer, { id: "group-1" })).toEqual({ ok: false, kind: "INVALID_INPUT", message: text("requires a perspective") });
  });
});

// --- 18 through 24: published-version selection and integrity -------------

describe("published-version selection", () => {
  it("reports no published version for the semester", async () => {
    const store = fakeStore((d) => { d.versions = [versionOf({ id: "ver-pub-s2", semester: 2 })]; });
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "NO_PUBLISHED_VERSION", semester: 1 });
  });
  it("refuses to break a tie between two published versions of one semester", async () => {
    const store = fakeStore((d) => { d.versions = [...d.versions, versionOf({ id: "ver-rival", publishedAt: new Date("2026-11-07T08:00:00.000Z") })]; });
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "AMBIGUOUS_PUBLISHED_VERSION", semester: 1 });
    expect(store.calls).not.toContain("readPublishedEntries");
  });
  it("returns valid publication metadata: id, semester and publication time", async () => {
    const result = ok(await read(fakeStore(), officer, {}));
    expect(result.version).toEqual({ id: PUB, semester: 1, publishedAt: PUB_AT });
    expect(result.semester).toBe(1);
  });
  it("refuses a PUBLISHED version with no publication time", async () => {
    const store = fakeStore((d) => { d.versions = [versionOf({ publishedAt: null })]; });
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "INVALID_PUBLISHED_DATA", message: text("no publication time") });
    expect(store.calls).not.toContain("readPublishedEntries");
  });
  it("fails closed on a stored version with an unreadable status", async () => {
    const store = fakeStore();
    store.listPublishedVersionsBySemester = async () => [versionOf({ status: "CORRUPT" as TimetableVersionStatus })];
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });
  it("fails closed when the version read leaks another semester", async () => {
    const store = fakeStore();
    store.listPublishedVersionsBySemester = async () => [versionOf({ id: "ver-pub-s2", semester: 2 })];
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });
  it("never presents a DRAFT or ARCHIVED re-read as the current publication", async () => {
    for (const status of ["DRAFT", "ARCHIVED"] as TimetableVersionStatus[]) {
      const store = fakeStore();
      store.readPublishedEntries = async () => ({ status: "current", version: versionOf({ status }), entries: [entryOf("e-1")] });
      expect(await read(store, officer, {})).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    }
  });
});

// --- 25 through 30: projection, integrity and ordering ---------------------

describe("projection and data integrity", () => {
  it("excludes a broken store's foreign-version entry from the result", async () => {
    const store = fakeStore(undefined, { leakEntry: entryOf("e-other", { versionId: "ver-someone-else" }) });
    const result = ok(await read(store, officer, { view: "group", id: "group-1" }));
    expect(result.entries.map((e) => e.id)).toEqual(["e-1", "e-3"]);
    expect(result.entries.every((e) => e.versionId === PUB)).toBe(true);
  });
  it("projects only the selected group, lecturer or venue", async () => {
    const group = ok(await read(fakeStore(), officer, { view: "group", id: "group-1" })).entries;
    expect(group.map((e) => e.id)).toEqual(["e-1", "e-3"]);
    expect(group.every((e) => e.groupId === "group-1")).toBe(true);
    const lect = ok(await read(fakeStore(), officer, { view: "lecturer", id: "lect-A" })).entries;
    expect(lect.map((e) => e.id)).toEqual(["e-1", "e-4"]);
    expect(lect.every((e) => e.lecturerId === "lect-A")).toBe(true);
    const venue = ok(await read(fakeStore(), officer, { view: "venue", id: "v-1" })).entries;
    expect(venue.map((e) => e.id)).toEqual(["e-1", "e-3"]);
    expect(venue.every((e) => e.venueId === "v-1")).toBe(true);
  });
  it("fails closed when an entry is missing required related data", async () => {
    for (const field of ["unitCode", "unitTitle", "groupId", "groupName", "lecturerId", "lecturerName", "venueCode"] as (keyof PublishedEntryRow)[]) {
      const store = fakeStore((d) => { const row = d.entries.find((e) => e.id === "e-1"); if (row) Object.assign(row, { [field]: null }); });
      const result = await read(store, officer, { view: "group", id: "group-1" });
      expect(result).toEqual({ ok: false, kind: "INVALID_PUBLISHED_DATA", message: text("missing required") });
    }
  });
  it("keeps a deterministic week order regardless of the store's row order", async () => {
    const forward = await read(fakeStore(), officer, { view: "lecturer", id: "lect-A" });
    const reversed = await read(fakeStore((d) => { d.entries = [...d.entries].reverse(); }), officer, { view: "lecturer", id: "lect-A" });
    expect(entryIds(forward)).toEqual(["e-1", "e-4"]);
    expect(reversed).toEqual(forward);
  });
});

// --- 31 through 34: consistency, failure handling and read-only proof ------

describe("consistency, failures and read-only guarantee", () => {
  it("reports STALE when a publication lands between resolution and the atomic read", async () => {
    const store = fakeStore(undefined, { race: (d) => { const prev = d.versions.find((v) => v.id === PUB); if (prev) prev.status = "ARCHIVED"; d.versions.push(versionOf({ id: "ver-new", publishedAt: new Date("2026-11-07T09:00:00.000Z") })); } });
    expect(await read(store, officer, {})).toEqual({ ok: false, kind: "STALE", semester: 1 });
    expect(store.calls).toContain("readPublishedEntries");
  });
  it("reports every store failure as INTERNAL_ERROR without leaking details", async () => {
    const cases: [keyof PublishedTimetableStore, Actor, unknown][] = [
      ["listStudentGroups", officer, {}], ["findLecturerByUserId", lecturer(), {}],
      ["listLecturers", officer, { view: "lecturer", id: "lect-A" }], ["listVenues", officer, { view: "venue", id: "v-1" }],
      ["listPublishedVersionsBySemester", officer, {}], ["readPublishedEntries", officer, {}],
    ];
    for (const [throwOn, actor, request] of cases) {
      const store = fakeStore(undefined, { throwOn });
      const result = await read(store, actor, request);
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(store.calls).toContain(throwOn);
      expect(JSON.stringify(result)).not.toMatch(/store down|SELECT|sqlite|prisma/i);
    }
  });
  it("logs one fixed non-sensitive line and keeps exception text out of the result", async () => {
    const secret = "postgres://tams:hunter2@db.internal:5432/tams";
    const store = fakeStore();
    store.listPublishedVersionsBySemester = async () => { throw new Error(`SELECT * FROM TimetableVersion; ${secret}`); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await read(store, officer, {});
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toMatch(/SELECT|db.internal|hunter2/i);
      expect(spy.mock.calls).toEqual([["[publishedTimetable] read failed; returning INTERNAL_ERROR"]]);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });
  it("exposes no write method and leaves all stored data byte-identical after a read", async () => {
    const store = fakeStore();
    const before = JSON.stringify(store.data);
    const functions = Object.keys(store).filter((k) => typeof (store as unknown as Record<string, unknown>)[k] === "function").sort();
    expect(functions).toEqual([...READ_METHODS].sort());
    expect((await read(store, officer, {})).ok).toBe(true);
    expect(JSON.stringify(store.data)).toBe(before);
  });
});

describe("M4-T4h forged selection and indirect disclosure regression", () => {
  it.each([
    { view: "group", id: "group-2" },
    { view: "lecturer", id: "lect-A" },
    { view: "lecturer", id: "lect-B" },
    { view: "venue", id: "v-1" },
    { view: "group", id: "nonexistent" },
  ])("student refuses forged $view/$id before publication reads", async request => {
    const store = fakeStore();
    expect(await read(store, student(), request)).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.calls).not.toContain("listPublishedVersionsBySemester");
    expect(store.calls).not.toContain("readPublishedEntries");
  });
  it("student explicit own group remains usable", async () => {
    expect(entryIds(await read(fakeStore(), student(), { view: "group", id: "group-1" }))).toEqual(["e-1", "e-3"]);
  });
  it.each([{ view: "lecturer", id: "lect-B" }, { view: "venue", id: "v-1" }])("lecturer refuses $view/$id", async request => {
    expect(await read(fakeStore(), lecturer(), request)).toEqual({ ok: false, kind: "FORBIDDEN" });
  });
  it("lecturer group view excludes colleagues teaching the same group", async () => {
    expect(entryIds(await read(fakeStore(), lecturer(), { view: "group", id: "group-1" }))).toEqual(["e-1"]);
    expect(entryIds(await read(fakeStore(), lecturer(), { view: "group", id: "group-2" }))).toEqual(["e-4"]);
  });
  it("missing lecturer link cannot be bypassed by an explicit id", async () => {
    expect(await read(fakeStore(), lecturer("nobody"), { view: "lecturer", id: "lect-A" })).toMatchObject({ ok: false, kind: "IDENTITY_UNRESOLVED" });
  });
  it.each(["DEPT_REP", "APPROVER"] as const)("%s limits group and cross-department lecturer projections", async role => {
    const a: Actor = { id: "rep", role, departmentId: "dept-1", studentGroupId: null };
    expect(entryIds(await read(fakeStore(), a, {}))).toEqual(["e-1", "e-3"]);
    expect(entryIds(await read(fakeStore(), a, { view: "lecturer", id: "lect-B" }))).toEqual(["e-3"]);
    expect(await read(fakeStore(), a, { view: "group", id: "group-2" })).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(await read(fakeStore(), a, { view: "venue", id: "v-1" })).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(await read(fakeStore(), { ...a, departmentId: null }, { view: "group", id: "group-1" })).toMatchObject({ ok: false, kind: "IDENTITY_UNRESOLVED" });
  });
});
