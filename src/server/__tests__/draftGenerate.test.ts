/**
 * M4-T2a — the secure generate-draft service contract, tested against an
 * injected fake store: no database, no real writes. The fake counts every call
 * and collects every write, so each refusal proves the one write method was
 * never reached and each success proves exactly what was handed to it. Covers
 * the bundle's 16 required scenarios: authorization and input validation before
 * any store access, semester scoping, locked-only fixed entries, source
 * preservation, refused sources, partial generation, locked-row problems, the
 * final-validation guard, the persistence payload, store failure, stale source,
 * the empty-semester policy and determinism.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedLecturerAvailabilities, seedTeachings, seedUnits, seedVenueUnavailabilities, seedVenues } from "@/domain/seedData";
import type { Actor } from "@/domain/permissions";
import type { TimetableVersionStatus, UserRole } from "@/domain/types";
import type { DraftEntryRow, DraftVersionRow, LecturerUnavailableRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import { performDraftGenerate } from "@/server/draftGenerate";
import type { DraftGenerateResult, DraftGenerateStore, GenerateAuditDraft, GeneratedDraftPayload, GenerationTeachingRow, SemesterTeachingRead } from "@/server/draftGenerateContract";

// --- Fixtures -------------------------------------------------------------

const officer: Actor = { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const forbiddenRoles: UserRole[] = ["ADMIN", "DEPT_REP", "APPROVER", "LECTURER", "STUDENT"];
const SOURCE_ID = "ver-src";
const VENUES: VenueRow[] = [
  { id: "v-hall", code: "LH1", capacity: 150, type: "HALL" },
  { id: "v-room", code: "CR1", capacity: 60, type: "ROOM" },
  { id: "v-lab", code: "LAB1", capacity: 40, type: "LAB" },
];

/** Semester 1, two one-hour ROOM sessions, placeable in v-room (capacity 60). */
function makeTeaching(id: string, overrides: Partial<GenerationTeachingRow> = {}): GenerationTeachingRow {
  return { id, lecturerId: "lecturer-A", groupId: "group-1", expectedSize: 40, unitCode: `UNIT-${id}`, venueTypeRequired: "ROOM", sessionsPerWeek: 2, sessionLength: 1, semester: 1, scheduled: true, ...overrides };
}

const readOf = (...teachings: GenerationTeachingRow[]): SemesterTeachingRead => ({ semesterExists: true, teachings });
const fixtureRead = (): SemesterTeachingRead => readOf(makeTeaching("t-a"), makeTeaching("t-b", { lecturerId: "lecturer-B", groupId: "group-2" }));
const makeVersion = (status: TimetableVersionStatus, semester = 1): DraftVersionRow => ({ id: SOURCE_ID, semester, status });

/** This source draft, MON 08:00-09:00 in v-room, unless the overrides say otherwise. */
function makeEntry(id: string, locked: boolean, overrides: Partial<DraftEntryRow> = {}): DraftEntryRow {
  return { id, versionId: SOURCE_ID, teachingId: "t-a", venueId: "v-room", day: "MON", start: "08:00", end: "09:00", locked, ...overrides };
}

/** One locked row and one unlocked row — only the locked one may be fixed. */
const SOURCE_ENTRIES: DraftEntryRow[] = [makeEntry("e-lock-1", true), makeEntry("e-free-1", false, { teachingId: "t-b", day: "TUE" })];

// --- Fake store: the injected DraftGenerateStore, with call counting -------

type FakeData = {
  versions?: DraftVersionRow[]; entries?: DraftEntryRow[]; teachingRead?: SemesterTeachingRead;
  venues?: VenueRow[]; lecturerUnavailable?: LecturerUnavailableRow[]; venueUnavailable?: VenueUnavailableRow[];
  persist?: { ok: true; versionId: string } | { stale: true }; throwOn?: keyof DraftGenerateStore;
  /** Simulates a broken read that ignores its own semester filter. */
  leak?: boolean;
};

type FakeStore = DraftGenerateStore & {
  calls: string[];
  writes: { payload: GeneratedDraftPayload; audit: GenerateAuditDraft }[];
  data: FakeData & { versions: DraftVersionRow[]; entries: DraftEntryRow[] };
};

function fakeStore(data: FakeData = {}): FakeStore {
  const full = {
    versions: data.versions ?? [makeVersion("DRAFT")], entries: data.entries ?? [],
    teachingRead: data.teachingRead ?? fixtureRead(), venues: data.venues ?? VENUES, ...data,
  };
  const store: FakeStore = {
    calls: [], writes: [], data: full,
    async findVersion(versionId) {
      gate("findVersion");
      return full.versions.find((row) => row.id === versionId) ?? null;
    },
    async listLockedEntriesByVersion(versionId) {
      gate("listLockedEntriesByVersion");
      // Deliberately leaks another version's rows: the service must keep only
      // the locked rows of the version it was asked about.
      return full.entries.filter((row) => row.versionId === versionId || row.id === "e-other");
    },
    async listTeachingsForSemester(semester) {
      gate("listTeachingsForSemester");
      if (full.leak === true) return full.teachingRead;
      return { ...full.teachingRead, teachings: full.teachingRead.teachings.filter((row) => row.semester === semester) };
    },
    async listActiveVenues() {
      gate("listActiveVenues");
      return full.venues;
    },
    async listLecturerUnavailableByLecturerIds(lecturerIds) {
      gate("listLecturerUnavailableByLecturerIds");
      return (full.lecturerUnavailable ?? []).filter((row) => lecturerIds.includes(row.lecturerId));
    },
    async listVenueUnavailableByVenueIds(venueIds) {
      gate("listVenueUnavailableByVenueIds");
      return (full.venueUnavailable ?? []).filter((row) => venueIds.includes(row.venueId));
    },
    async persistGeneratedDraft(payload, audit) {
      gate("persistGeneratedDraft");
      store.writes.push({ payload, audit });
      return full.persist ?? { ok: true, versionId: "ver-new-1" };
    },
  };
  return store;

  function gate(name: keyof DraftGenerateStore) {
    store.calls.push(name);
    if (full.throwOn === name) throw new Error("store down");
  }
}

// --- Assertion helpers ----------------------------------------------------

/** Zero store operations is the proof that authorization ran first. */
function expectNoStoreAccess(store: FakeStore) {
  expect(store.calls).toEqual([]);
  expect(store.writes).toEqual([]);
}

/**
 * Each helper below asserts the typed refusal, asserts that nothing was
 * persisted, and narrows the result so the caller can inspect its detail.
 */
function problemsOf(result: DraftGenerateResult, store: FakeStore) {
  if (result.ok || result.kind !== "INCOMPLETE_INPUT") throw new Error(`expected INCOMPLETE_INPUT, got ${JSON.stringify(result)}`);
  expect(store.writes).toHaveLength(0);
  return result.problems;
}

function unplacedOf(result: DraftGenerateResult, store: FakeStore) {
  if (result.ok || result.kind !== "PARTIAL_GENERATION") throw new Error(`expected PARTIAL_GENERATION, got ${JSON.stringify(result)}`);
  expect(store.writes).toHaveLength(0);
  return result.unplaced;
}

function generationOf(result: DraftGenerateResult, store: FakeStore) {
  if (result.ok || result.kind !== "INVALID_GENERATION") throw new Error(`expected INVALID_GENERATION, got ${JSON.stringify(result)}`);
  expect(store.writes).toHaveLength(0);
  return result;
}

function messageOf(result: DraftGenerateResult, store: FakeStore) {
  if (result.ok || result.kind !== "INVALID_INPUT") throw new Error(`expected INVALID_INPUT, got ${JSON.stringify(result)}`);
  expectNoStoreAccess(store);
  return result.message;
}

const text = (expected: string): string => expect.stringContaining(expected) as unknown as string;
const kinds = (items: { kind: string }[]) => items.map((item) => item.kind);

// --- Seed-shaped rows for the real partial case (seed data never edited) ---

const seedTeachingRows: GenerationTeachingRow[] = seedTeachings.flatMap((teaching) => {
  const unit = seedUnits.find((candidate) => candidate.id === teaching.unitId);
  if (unit === undefined) throw new Error(`seed teaching ${teaching.id} has no seeded unit`);
  return [{ id: teaching.id, lecturerId: teaching.lecturerId, groupId: teaching.groupId, expectedSize: teaching.expectedSize, unitCode: unit.code, venueTypeRequired: unit.venueTypeRequired, sessionsPerWeek: teaching.sessionsPerWeek, sessionLength: teaching.sessionLength, semester: unit.semester, scheduled: unit.scheduled }];
});

const seedLecturerRows: LecturerUnavailableRow[] = seedLecturerAvailabilities.map((row) => ({ id: row.id, lecturerId: row.lecturerId, day: row.day, start: row.start, end: row.end, available: row.available }));
const seedVenueUnavailableRows: VenueUnavailableRow[] = seedVenueUnavailabilities.map((row) => ({ id: row.id, venueId: row.venueId, day: row.day, start: row.start, end: row.end, reason: row.reason }));

const seededStore = (): FakeStore => fakeStore({
  teachingRead: readOf(...seedTeachingRows.filter((row) => row.semester === 1 && row.scheduled)),
  venues: seedVenues.filter((venue) => venue.status === "ACTIVE").map((venue) => ({ id: venue.id, code: venue.code, capacity: venue.capacity, type: venue.type })),
  lecturerUnavailable: seedLecturerRows,
  venueUnavailable: seedVenueUnavailableRows,
});

// --- 1 and 2: authorization and input validation before any store access --

describe("authorization", () => {
  it("refuses an unauthenticated or forbidden caller with zero store operations", async () => {
    const actors: (Actor | null)[] = [null, ...forbiddenRoles.map((role): Actor => ({ id: `user-${role}`, role, departmentId: null, studentGroupId: null }))];
    for (const actor of actors) {
      const store = fakeStore();
      expect(await performDraftGenerate(store, actor, { semester: 1 })).toEqual({ ok: false, kind: actor === null ? "UNAUTHENTICATED" : "FORBIDDEN" });
      expectNoStoreAccess(store);
    }
    // An actor id or role inside the request body never grants anything.
    const store = fakeStore();
    const forged = { semester: 1, actorId: "user-attacker", role: "OFFICER" };
    expect(await performDraftGenerate(store, null, forged)).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectNoStoreAccess(store);
  });

  it("validates the semester scope before reading anything", async () => {
    for (const semester of [0, 3, 1.5, Number.NaN]) {
      const store = fakeStore();
      const result = await performDraftGenerate(store, officer, { semester });
      expect(messageOf(result, store)).toBe("Semester must be 1 or 2.");
    }
  });

  it("refuses an empty source version id before reading anything", async () => {
    const store = fakeStore();
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: "  " });
    expect(messageOf(result, store)).toBe("Source version id is required");
  });
});

// --- 3, 12 and 16: a complete draft, its payload, determinism -------------

describe("complete generation and persistence contract", () => {
  it("generates a complete draft and persists it as a new DRAFT version", async () => {
    const store = fakeStore();
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    expect(result).toEqual({ ok: true, versionId: "ver-new-1", entryCount: 4, softScore: expect.any(Number) as unknown as number });
    expect(store.calls).toEqual([
      "listTeachingsForSemester", "listActiveVenues", "listLecturerUnavailableByLecturerIds",
      "listVenueUnavailableByVenueIds", "persistGeneratedDraft",
    ]);
  });

  it("passes the version, entries and audit fields the store needs", async () => {
    const store = fakeStore();
    await performDraftGenerate(store, officer, { semester: 1 });
    expect(store.writes).toHaveLength(1);
    const { payload, audit } = store.writes[0];
    expect([payload.status, payload.semester, payload.createdBy, payload.sourceVersionId, payload.expectedSource]).toEqual(["DRAFT", 1, "user-officer", null, null]);
    expect(payload.entries).toHaveLength(4);
    for (const entry of payload.entries) {
      expect([entry.locked, entry.sourceEntryId, entry.venueId]).toEqual([false, null, "v-room"]);
      expect(["t-a", "t-b"]).toContain(entry.teachingId);
      expect(entry.start < entry.end).toBe(true);
    }
    expect(audit).toEqual({ actorId: "user-officer", action: "TIMETABLE_DRAFT_GENERATE", entity: "TimetableVersion", reason: text("4 entries for semester 1") });
  });

  it("produces the same draft for the same input and policy", async () => {
    const first = fakeStore();
    const second = fakeStore();
    expect(await performDraftGenerate(second, officer, { semester: 1 })).toEqual(await performDraftGenerate(first, officer, { semester: 1 }));
    expect(second.writes[0].payload).toEqual(first.writes[0].payload);
  });

  it("reports a store failure as INTERNAL_ERROR without claiming a version", async () => {
    const store = fakeStore({ throwOn: "persistGeneratedDraft" });
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect("versionId" in result).toBe(false);
    expect(store.calls[store.calls.length - 1]).toBe("persistGeneratedDraft");
  });
});

// --- 4: semester scoping --------------------------------------------------

describe("semester scoping", () => {
  it("schedules only the requested semester, never both", async () => {
    const read = readOf(makeTeaching("t-s1"), makeTeaching("t-s2", { semester: 2 }));
    for (const [semester, teachingId] of [[1, "t-s1"], [2, "t-s2"]] as const) {
      const store = fakeStore({ teachingRead: read });
      const result = await performDraftGenerate(store, officer, { semester });
      expect(result.ok).toBe(true);
      const { payload } = store.writes[0];
      expect(payload.semester).toBe(semester);
      expect(payload.entries.map((entry) => entry.teachingId)).toEqual([teachingId, teachingId]);
    }
  });

  it("refuses a read that leaked another semester or an unscheduled unit", async () => {
    const store = fakeStore({ leak: true, teachingRead: readOf(makeTeaching("t-a"), makeTeaching("t-s2", { semester: 2 }), makeTeaching("t-draft-only", { scheduled: false })) });
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    expect(kinds(problemsOf(result, store))).toEqual(["DATASET_SCOPE_MISMATCH"]);
  });
});

// --- 5, 6 and 7: locked entries only, source untouched --------------------

describe("locked entries", () => {
  it("carries only the source's locked rows, unchanged, into the new draft", async () => {
    const entries = [...SOURCE_ENTRIES, makeEntry("e-other", true, { versionId: "ver-x" })];
    const store = fakeStore({ entries });
    const entrySnapshot = JSON.stringify(store.data.entries);
    const versionSnapshot = JSON.stringify(store.data.versions);
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    expect(result.ok).toBe(true);
    const { payload } = store.writes[0];
    // t-a keeps its locked 1h row so only one more session is owed; t-b owes two.
    expect(payload.entries).toHaveLength(4);
    expect(payload.entries.filter((entry) => entry.locked)).toHaveLength(1);
    expect(payload.entries.filter((entry) => entry.sourceEntryId !== null)).toEqual([{ teachingId: "t-a", venueId: "v-room", day: "MON", start: "08:00", end: "09:00", locked: true, sourceEntryId: "e-lock-1" }]);
    expect(payload.sourceVersionId).toBe(SOURCE_ID);
    // The source draft and its rows are read-only inputs, never targets.
    expect(JSON.stringify(store.data.entries)).toBe(entrySnapshot);
    expect(JSON.stringify(store.data.versions)).toBe(versionSnapshot);
    expect(store.calls.filter((call) => call === "persistGeneratedDraft")).toHaveLength(1);
  });

  it("carries an order-independent source fingerprint for the write to check", async () => {
    const locked = [makeEntry("e-lock-1", true), makeEntry("e-lock-2", true, { teachingId: "t-b", start: "09:00", end: "10:00" })];
    const forward = fakeStore({ entries: locked });
    const reverse = fakeStore({ entries: [...locked].reverse() });
    await performDraftGenerate(forward, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    await performDraftGenerate(reverse, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    expect(forward.writes[0].payload.expectedSource).toEqual({ versionId: SOURCE_ID, versionStatus: "DRAFT", lockedFingerprint: text("e-lock-1|t-a|v-room|MON|08:00|09:00") });
    expect(reverse.writes[0].payload.expectedSource).toEqual(forward.writes[0].payload.expectedSource);
    expect(forward.writes[0].payload.expectedSource?.lockedFingerprint.split(";")).toHaveLength(2);
  });
});

// --- 8: refused sources ---------------------------------------------------

describe("source status", () => {
  for (const status of ["PUBLISHED", "ARCHIVED"] as TimetableVersionStatus[]) {
    it(`refuses a ${status.toLowerCase()} source before loading any data`, async () => {
      const store = fakeStore({ versions: [makeVersion(status)], entries: SOURCE_ENTRIES });
      const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
      expect(result).toEqual({ ok: false, kind: "SOURCE_NOT_DRAFT", sourceVersionId: SOURCE_ID, storedStatus: status });
      expect(store.calls).toEqual(["findVersion"]);
      expect(store.writes).toHaveLength(0);
    });
  }

  it("refuses a missing source without reading the semester", async () => {
    const store = fakeStore({ versions: [] });
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: "nope" });
    expect(result).toEqual({ ok: false, kind: "SOURCE_NOT_FOUND", sourceVersionId: "nope" });
    expect(store.calls).toEqual(["findVersion"]);
  });

  it("refuses a source draft from another semester", async () => {
    const store = fakeStore({ versions: [makeVersion("DRAFT", 2)], entries: SOURCE_ENTRIES });
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    expect(kinds(problemsOf(result, store))).toContain("SOURCE_SEMESTER_MISMATCH");
  });
});

// --- 9 and 10: nothing incomplete is persisted ----------------------------

describe("fail-closed persistence policy", () => {
  it("returns the seeded partial result with explanations and persists nothing", async () => {
    const store = seededStore();
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    const unplaced = unplacedOf(result, store);
    expect(unplaced.length).toBeGreaterThan(0);
    expect(unplaced.every((item) => item.message.length > 20)).toBe(true);
    expect(unplaced.some((item) => item.message.includes("LAB"))).toBe(true);
  });

  it("reports a locked entry whose teaching is not in the semester", async () => {
    const store = fakeStore({ entries: [makeEntry("e-orphan", true, { teachingId: "t-gone" })] });
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    expect(problemsOf(result, store)).toEqual([{ kind: "SOURCE_ENTRY_UNRESOLVED", entryId: "e-orphan", message: text("not scheduled in semester 1") }]);
  });

  it("refuses persistence when two locked rows clash", async () => {
    const store = fakeStore({ entries: [makeEntry("e-lock-1", true), makeEntry("e-lock-2", true, { teachingId: "t-b" })] });
    const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
    expect(kinds(unplacedOf(result, store))).toContain("FIXED");
  });

  it("refuses persistence when a lecturer is unavailable for every slot", async () => {
    const lecturerUnavailable: LecturerUnavailableRow[] = ["MON", "TUE", "WED", "THU", "FRI"].flatMap((day) => Array.from({ length: 9 }, (_, index) => ({
      id: `la-${day}-${index}`, lecturerId: "lecturer-A", day, available: false as const,
      start: `${String(8 + index).padStart(2, "0")}:00`, end: `${String(9 + index).padStart(2, "0")}:00`,
    })));
    const store = fakeStore({ teachingRead: readOf(makeTeaching("t-a")), lecturerUnavailable });
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    expect(unplacedOf(result, store).map((item) => item.reason)).toEqual(["NO_FREE_SLOT", "NO_FREE_SLOT"]);
  });
});

// --- 11: the final-validation guard. The generator self-checks through the
// accepted validator, so this branch is defence in depth: the stub replaces
// only the generator's claim that the board is clean, never the validator.

describe("final validation before persistence", () => {
  afterEach(() => {
    vi.doUnmock("@/domain/generator");
    vi.resetModules();
  });

  type StubEntry = { id: string; teachingId: string; venueId: string; day: string; start: string; end: string };

  async function generateThatClaims(entries: StubEntry[]) {
    vi.doMock("@/domain/generator", () => ({ generateTimetable: () => ({ entries, unplaced: [], softScore: 0 }) }));
    vi.resetModules();
    return (await import("@/server/draftGenerate")).performDraftGenerate;
  }

  it("refuses a board with a hard violation even when unplaced is empty", async () => {
    const perform = await generateThatClaims([
      { id: "gen-1", teachingId: "t-a", venueId: "v-room", day: "MON", start: "08:00", end: "09:00" },
      { id: "gen-2", teachingId: "t-b", venueId: "v-room", day: "MON", start: "08:00", end: "09:00" },
    ]);
    const store = fakeStore();
    const failure = generationOf(await perform(store, officer, { semester: 1 }), store);
    expect(failure.violations.map((violation) => violation.type)).toEqual(["VENUE_OVERLAP"]);
    expect(failure.missingContext).toEqual([]);
  });

  it("refuses an incomplete validation even with zero violations", async () => {
    const perform = await generateThatClaims([{ id: "gen-1", teachingId: "t-ghost", venueId: "v-room", day: "MON", start: "08:00", end: "09:00" }]);
    const store = fakeStore();
    const failure = generationOf(await perform(store, officer, { semester: 1 }), store);
    expect(failure.violations).toEqual([]);
    expect(kinds(failure.missingContext)).toEqual(["MISSING_TEACHING"]);
  });
});

// --- 13 and 14: stale source and store failure ----------------------------

describe("concurrency and store failure", () => {
  it("reports STALE when the atomic write is rejected, with or without a source", async () => {
    for (const sourceVersionId of [SOURCE_ID, null] as const) {
      const store = fakeStore({ persist: { stale: true }, entries: SOURCE_ENTRIES });
      const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId });
      expect(result).toEqual({ ok: false, kind: "STALE", sourceVersionId });
      expect(store.writes[0].payload.expectedSource?.versionId ?? null).toBe(sourceVersionId);
    }
  });

  it("reports INTERNAL_ERROR when a read fails, never as an empty dataset", async () => {
    for (const throwOn of ["findVersion", "listLockedEntriesByVersion", "listTeachingsForSemester", "listActiveVenues", "listLecturerUnavailableByLecturerIds"] as const) {
      const store = fakeStore({ throwOn, entries: SOURCE_ENTRIES });
      const result = await performDraftGenerate(store, officer, { semester: 1, sourceVersionId: SOURCE_ID });
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(store.calls).toContain(throwOn);
      expect(store.writes).toHaveLength(0);
    }
  });
});

// --- 15: empty input policy ----------------------------------------------

describe("documented empty-input policy", () => {
  it("distinguishes an empty semester from an unknown one and writes neither", async () => {
    for (const [semester, semesterExists, kind] of [[1, true, "NO_SCHEDULED_TEACHINGS"], [2, false, "SEMESTER_NOT_FOUND"]] as const) {
      const store = fakeStore({ teachingRead: { semesterExists, teachings: [] } });
      const result = await performDraftGenerate(store, officer, { semester });
      expect(kinds(problemsOf(result, store))).toEqual([kind]);
    }
  });

  it("refuses to generate when no venue is active", async () => {
    const store = fakeStore({ venues: [] });
    const result = await performDraftGenerate(store, officer, { semester: 1 });
    expect(kinds(problemsOf(result, store))).toEqual(["NO_ACTIVE_VENUES"]);
  });
});
