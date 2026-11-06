/**
 * M4-T2c1 — the server action exposing the accepted performDraftGenerate()
 * service to the officer's browser.
 *
 * Following draftMoveActions.test.ts and draftAddActions.test.ts, next/headers,
 * the session helper and the Prisma generate-store factory are mocked and a
 * fake implementing the real DraftGenerateStore contract is injected. The
 * shipped service, generator and M3 validator run on top of it, so no fake
 * business rule can contradict accepted behaviour. The fake counts every method
 * call and collects every write, and the factory is itself a mock, so each
 * denial also proves the stronger claim: the Prisma store was never created.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedLecturerAvailabilities, seedTeachings, seedUnits, seedVenueUnavailabilities, seedVenues } from "@/domain/seedData";
import type { SafeUser } from "@/server/auth";
import type { TimetableVersionStatus, UserRole } from "@/domain/types";
import type { DraftEntryRow, DraftVersionRow, LecturerUnavailableRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import type {
  DraftGenerateStore, GenerateAuditDraft, GeneratedDraftPayload, GenerationTeachingRow, SemesterTeachingRead,
} from "@/server/draftGenerateContract";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), createDraftGenerateStore: vi.fn(), headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/draftGenerateStorePrisma", () => ({ createDraftGenerateStore: mocks.createDraftGenerateStore }));

import { generateDraftAction } from "@/app/officer/draft/generateActions";

// --- Session users: the actor is always the session, never the payload -----

const officer: SafeUser = {
  id: "user-officer", name: "Timetabling Officer", email: "officer@demo.tams.test",
  role: "OFFICER", departmentId: null, studentGroupId: null,
};
const userForRole = (role: UserRole): SafeUser => ({
  id: `user-${role.toLowerCase()}`, name: `${role} user`, email: `${role.toLowerCase()}@demo.tams.test`,
  role, departmentId: null, studentGroupId: null,
});

// --- Fixtures --------------------------------------------------------------

const SOURCE_ID = "ver-src";
const VENUES: VenueRow[] = [
  { id: "v-hall", code: "LH1", capacity: 150, type: "HALL" },
  { id: "v-room", code: "CR1", capacity: 60, type: "ROOM" },
];
const makeTeaching = (id: string, semester: number): GenerationTeachingRow => ({
  id, lecturerId: `lecturer-${id}`, groupId: `group-${id}`, expectedSize: 40, unitCode: `UNIT-${id}`,
  venueTypeRequired: "ROOM", sessionsPerWeek: 2, sessionLength: 1, semester, scheduled: true,
});
/** Two teachings in semester 1, one in semester 2 — both scopes are placeable. */
const teachingRead = (): SemesterTeachingRead => ({
  semesterExists: true, teachings: [makeTeaching("t-a", 1), makeTeaching("t-b", 1), makeTeaching("t-c", 2)],
});
const makeVersion = (status: TimetableVersionStatus): DraftVersionRow => ({ id: SOURCE_ID, semester: 1, status });
/** Source draft row MON 08:00-09:00 @ CR1 for t-a. */
const makeEntry = (id: string, locked: boolean): DraftEntryRow => ({
  id, versionId: SOURCE_ID, teachingId: "t-a", venueId: "v-room", day: "MON", start: "08:00", end: "09:00", locked,
});
/** Every weekday 08:00-17:00 blocked for lecturer-t-a: that teaching cannot place. */
const BLOCKED_LECTURER: LecturerUnavailableRow[] = ["MON", "TUE", "WED", "THU", "FRI"].flatMap((day) =>
  Array.from({ length: 9 }, (_, i) => ({
    id: `la-${day}-${i}`, lecturerId: "lecturer-t-a", day, available: false as const,
    start: `${String(8 + i).padStart(2, "0")}:00`, end: `${String(9 + i).padStart(2, "0")}:00`,
  })),
);

// --- Fake store: the real contract interface, with call and write counting --

type FakeData = {
  versions?: DraftVersionRow[]; entries?: DraftEntryRow[]; teachingRead?: SemesterTeachingRead;
  venues?: VenueRow[]; lecturerUnavailable?: LecturerUnavailableRow[]; venueUnavailable?: VenueUnavailableRow[];
  persist?: { ok: true; versionId: string } | { stale: true }; throwOn?: keyof DraftGenerateStore;
};
type FakeStore = DraftGenerateStore & {
  calls: string[]; writes: { payload: GeneratedDraftPayload; audit: GenerateAuditDraft }[];
};

function fakeStore(data: FakeData = {}): FakeStore {
  const full = {
    versions: data.versions ?? [makeVersion("DRAFT")], entries: data.entries ?? [makeEntry("e-lock-1", true)],
    teachingRead: data.teachingRead ?? teachingRead(), venues: data.venues ?? VENUES,
  };
  const store: FakeStore = {
    calls: [], writes: [],
    findVersion(versionId) { gate("findVersion"); return Promise.resolve(full.versions.find((r) => r.id === versionId) ?? null); },
    listLockedEntriesByVersion(versionId) {
      gate("listLockedEntriesByVersion");
      return Promise.resolve(full.entries.filter((row) => row.versionId === versionId && row.locked));
    },
    listTeachingsForSemester(semester) {
      gate("listTeachingsForSemester");
      return Promise.resolve({ semesterExists: full.teachingRead.semesterExists, teachings: full.teachingRead.teachings.filter((row) => row.semester === semester) });
    },
    listActiveVenues() { gate("listActiveVenues"); return Promise.resolve(full.venues); },
    // Mirrors the accepted adapter: available:true restricts nothing and must
    // never reach the generator as a block.
    listLecturerUnavailableByLecturerIds(lecturerIds) {
      gate("listLecturerUnavailableByLecturerIds");
      return Promise.resolve((data.lecturerUnavailable ?? []).filter((row) => lecturerIds.includes(row.lecturerId) && row.available === false));
    },
    listVenueUnavailableByVenueIds(venueIds) {
      gate("listVenueUnavailableByVenueIds");
      return Promise.resolve((data.venueUnavailable ?? []).filter((row) => venueIds.includes(row.venueId)));
    },
    persistGeneratedDraft(payload, audit) {
      gate("persistGeneratedDraft");
      store.writes.push({ payload, audit });
      return Promise.resolve(data.persist ?? { ok: true, versionId: "ver-new-1" });
    },
  };
  return store;

  function gate(name: keyof DraftGenerateStore) {
    store.calls.push(name);
    if (data.throwOn === name) throw new Error("table TimetableVersion does not exist (internal detail)");
  }
}

// --- Wiring ----------------------------------------------------------------

let store: FakeStore;
const sameOriginHeaders = () => new Headers({ origin: "http://localhost:3000", host: "localhost:3000" });
function install(data: FakeData = {}) {
  store = fakeStore(data);
  mocks.createDraftGenerateStore.mockReturnValue(store);
}
beforeEach(() => {
  vi.clearAllMocks();
  install();
  mocks.headers.mockResolvedValue(sameOriginHeaders());
  mocks.getCurrentUser.mockResolvedValue(officer);
});

/** The proof requirement 2 asks for: no store object exists, so no read ran. */
function expectNoStore() {
  expect(mocks.createDraftGenerateStore).not.toHaveBeenCalled();
  expect(store.calls).toEqual([]);
  expect(store.writes).toEqual([]);
}
const validInput = (overrides: Record<string, unknown> = {}) => ({ semester: 1, ...overrides });

// --- 1 and 2: enforcement order — nothing reaches the database -------------

describe("generateDraftAction enforcement order", () => {
  it("refuses a cross-origin call before the session or the store is read", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin: "http://attacker.example", host: "localhost:3000" }));
    expect(await generateDraftAction(validInput())).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expectNoStore();
  });

  it("refuses a call whose only signal is Sec-Fetch-Site: cross-site", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "sec-fetch-site": "cross-site" }));
    expect(await generateDraftAction(validInput())).toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoStore();
  });

  it("returns UNAUTHENTICATED with no session and creates no store", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await generateDraftAction(validInput())).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectNoStore();
  });

  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER", "ADMIN"] as UserRole[])(
    "refuses a %s caller as FORBIDDEN with the store never constructed",
    async (role) => {
      mocks.getCurrentUser.mockResolvedValue(userForRole(role));
      expect(await generateDraftAction(validInput())).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoStore();
    },
  );

  it("refuses a forbidden role even when the payload names an officer", async () => {
    // Authorization is decided before the shape check, so a forged actor field
    // cannot even reach validation, let alone grant anything.
    mocks.getCurrentUser.mockResolvedValue(userForRole("STUDENT"));
    expect(await generateDraftAction(validInput({ actorId: officer.id, role: "OFFICER" })))
      .toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoStore();
  });
});

// --- 3 and 4: the shape boundary (semester stays a number) -----------------

describe("generateDraftAction input boundary", () => {
  it.each([
    { name: "semester 0", input: { semester: 0 } },
    { name: "semester 3", input: { semester: 3 } },
    { name: "a fractional semester", input: { semester: 1.5 } },
    { name: "NaN", input: { semester: Number.NaN } },
    { name: "a string semester", input: { semester: "1" } },
    { name: "a missing semester", input: {} },
    { name: "a null semester", input: { semester: null } },
    { name: "an empty source id", input: { semester: 1, sourceVersionId: "" } },
    { name: "a blank source id", input: { semester: 1, sourceVersionId: "   " } },
    { name: "a non-string source id", input: { semester: 1, sourceVersionId: 42 } },
    { name: "no input at all", input: undefined },
  ])("rejects $name as INVALID_INPUT with zero store calls", async ({ input }) => {
    expect(await generateDraftAction(input)).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expectNoStore();
  });

  it.each(["actorId", "createdBy", "userId", "role", "status", "locked", "softScore", "versionId", "expectedSource"])(
    "rejects a payload carrying the forged field %s and never echoes it back",
    async (key) => {
      const result = await generateDraftAction(validInput({ [key]: "attacker" }));
      expect(result).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
      expect(JSON.stringify(result)).not.toContain("attacker");
      expectNoStore();
    },
  );

  it("phrases a forged key as a refusal the officer can act on", async () => {
    const result = await generateDraftAction(validInput({ locked: true }));
    if (result.ok || result.kind !== "INVALID_INPUT") throw new Error(JSON.stringify(result));
    expect(result.message).toContain("cannot carry extra fields");
    expectNoStore();
  });

  it("accepts both semesters and generates the scoped draft for each", async () => {
    for (const [semester, teachingId] of [[1, "t-a"], [2, "t-c"]] as const) {
      install();
      const result = await generateDraftAction({ semester });
      expect(result).toMatchObject({ ok: true, entryCount: semester === 1 ? 4 : 2 });
      expect(store.writes[0].payload.semester).toBe(semester);
      expect(store.writes[0].payload.entries.every((e) => semester === 1 || e.teachingId === teachingId)).toBe(true);
    }
  });

  it("accepts an explicit null source and trims a padded source id", async () => {
    install();
    expect(await generateDraftAction({ semester: 1, sourceVersionId: null })).toMatchObject({ ok: true });
    expect(store.calls).not.toContain("findVersion");
    install();
    expect(await generateDraftAction({ semester: 1, sourceVersionId: `  ${SOURCE_ID}  ` })).toMatchObject({ ok: true });
    expect(store.writes[0].payload.sourceVersionId).toBe(SOURCE_ID);
  });
});

// --- 5 and 6: what actually reaches the accepted service -------------------

describe("generateDraftAction service hand-off", () => {
  it("passes the session actor and the source draft, and persists exactly once", async () => {
    const result = await generateDraftAction({ semester: 1, sourceVersionId: SOURCE_ID });
    expect(result).toMatchObject({ ok: true, versionId: "ver-new-1" });
    expect(store.calls.slice(0, 2)).toEqual(["findVersion", "listLockedEntriesByVersion"]);
    expect(store.writes).toHaveLength(1);
    const { payload, audit } = store.writes[0];
    // createdBy and the audit actor come from the session, not the request.
    expect(audit).toEqual({
      actorId: officer.id, action: "TIMETABLE_DRAFT_GENERATE", entity: "TimetableVersion",
      reason: expect.any(String) as unknown as string,
    });
    expect([payload.createdBy, payload.status, payload.sourceVersionId]).toEqual([officer.id, "DRAFT", SOURCE_ID]);
    expect(payload.expectedSource).toMatchObject({ versionId: SOURCE_ID, versionStatus: "DRAFT" });
    expect(payload.entries.filter((entry) => entry.locked)).toHaveLength(1);
  });

  it("generates without a source when no version id is sent", async () => {
    expect(await generateDraftAction({ semester: 1 })).toMatchObject({ ok: true });
    expect(store.calls).not.toContain("findVersion");
    expect([store.writes[0].payload.sourceVersionId, store.writes[0].payload.expectedSource]).toEqual([null, null]);
  });
});

// --- 7: typed results propagate unchanged and are never over-claimed -------

describe("generateDraftAction result propagation", () => {
  it("returns the service success object exactly — no added claims", async () => {
    const result = await generateDraftAction({ semester: 1 });
    expect(result).toEqual({
      ok: true, versionId: "ver-new-1", entryCount: 4, softScore: expect.any(Number) as unknown as number,
    });
    expect(Object.keys(result).sort()).toEqual(["entryCount", "ok", "softScore", "versionId"]);
  });

  it("propagates PARTIAL_GENERATION without presenting the placed count as saved", async () => {
    install({ lecturerUnavailable: BLOCKED_LECTURER });
    const result = await generateDraftAction({ semester: 1 });
    expect(result).toMatchObject({ ok: false, kind: "PARTIAL_GENERATION", placedCount: 2 });
    if (result.ok || result.kind !== "PARTIAL_GENERATION") return;
    expect(result.unplaced.map((item) => item.reason)).toEqual(["NO_FREE_SLOT", "NO_FREE_SLOT"]);
    // Nothing was written, so the result carries no version reference at all:
    // a placement count is never offered as proof that a version exists.
    expect(store.writes).toHaveLength(0);
    expect(Object.keys(result).sort()).toEqual(["kind", "ok", "placedCount", "softScore", "unplaced"]);
  });

  it("propagates STALE with the source it was refused against", async () => {
    install({ persist: { stale: true } });
    expect(await generateDraftAction({ semester: 1, sourceVersionId: SOURCE_ID })).toEqual({
      ok: false, kind: "STALE", sourceVersionId: SOURCE_ID,
    });
    expect(store.calls.filter((call) => call === "persistGeneratedDraft")).toHaveLength(1);
  });

  it("propagates INCOMPLETE_INPUT with the structured problems", async () => {
    install({ venues: [] });
    const result = await generateDraftAction({ semester: 1 });
    expect(result).toMatchObject({ ok: false, kind: "INCOMPLETE_INPUT" });
    if (result.ok || result.kind !== "INCOMPLETE_INPUT") return;
    expect(result.problems.map((problem) => problem.kind)).toEqual(["NO_ACTIVE_VENUES"]);
    expect(store.writes).toHaveLength(0);
  });

  it.each(["listTeachingsForSemester", "persistGeneratedDraft"] as const)(
    "propagates the service INTERNAL_ERROR when the store fails on %s",
    async (throwOn) => {
      install({ throwOn });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await generateDraftAction({ semester: 1 })).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(store.writes).toHaveLength(0);
      errorLog.mockRestore();
    },
  );

  it("converts an unexpected store-factory failure to a safe INTERNAL_ERROR", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createDraftGenerateStore.mockImplementation(() => {
      throw new Error("postgres://user:password@host/db leaked (internal detail)");
    });
    const result = await generateDraftAction(validInput());
    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("postgres");
    expect(JSON.stringify(result)).not.toContain("password");
    // The log receives the message only, never the Error object or the payload.
    const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("leaked");
    expect(logged).not.toContain(JSON.stringify(validInput()));
    errorLog.mockRestore();
  });
});

// --- 22: refusal accounting, measured on the real seeded dataset -----------

describe("generateDraftAction refusal accounting", () => {
  it("writes nothing for the partial seeded semester 1 and never calls it success", async () => {
    // The seeded data is the honest prototype gap: no LAB seats the 45-student
    // SE-Y4 groups, so the accepted service refuses to persist at all.
    const seedRead: SemesterTeachingRead = {
      semesterExists: true,
      teachings: seedTeachings.map((teaching) => {
        const unit = seedUnits.find((c) => c.id === teaching.unitId);
        if (unit === undefined) throw new Error(`seed teaching ${teaching.id} has no seeded unit`);
        return {
          id: teaching.id, lecturerId: teaching.lecturerId, groupId: teaching.groupId,
          expectedSize: teaching.expectedSize, unitCode: unit.code, venueTypeRequired: unit.venueTypeRequired,
          sessionsPerWeek: teaching.sessionsPerWeek, sessionLength: teaching.sessionLength,
          semester: unit.semester, scheduled: unit.scheduled,
        };
      }).filter((row) => row.semester === 1 && row.scheduled)
        .sort((a, b) => (a.id < b.id ? -1 : 1)), // same id order as the adapter
    };
    install({
      teachingRead: seedRead,
      venues: seedVenues.filter((v) => v.status === "ACTIVE")
        .map((v) => ({ id: v.id, code: v.code, capacity: v.capacity, type: v.type })),
      lecturerUnavailable: seedLecturerAvailabilities.map((row) => ({
        id: row.id, lecturerId: row.lecturerId, day: row.day, start: row.start, end: row.end, available: row.available,
      })),
      venueUnavailable: seedVenueUnavailabilities.map((row) => ({
        id: row.id, venueId: row.venueId, day: row.day, start: row.start, end: row.end, reason: row.reason,
      })),
    });
    expect(await generateDraftAction({ semester: 1 })).toMatchObject({
      ok: false, kind: "PARTIAL_GENERATION", placedCount: 51,
    });
    expect(store.writes).toHaveLength(0);
    expect(store.calls.filter((call) => call === "persistGeneratedDraft")).toHaveLength(0);
  });

  it("creates no store for any denied or malformed request", async () => {
    const denied: unknown[] = [];
    mocks.headers.mockResolvedValue(new Headers({ origin: "http://attacker.example", host: "localhost:3000" }));
    denied.push(await generateDraftAction(validInput()));
    mocks.headers.mockResolvedValue(sameOriginHeaders());
    mocks.getCurrentUser.mockResolvedValue(null);
    denied.push(await generateDraftAction(validInput()));
    for (const role of ["STUDENT", "LECTURER", "DEPT_REP", "APPROVER", "ADMIN"] as UserRole[]) {
      mocks.getCurrentUser.mockResolvedValue(userForRole(role));
      denied.push(await generateDraftAction(validInput()));
    }
    mocks.getCurrentUser.mockResolvedValue(officer);
    denied.push(await generateDraftAction({ semester: 7 }));
    denied.push(await generateDraftAction({ actorId: "attacker" }));
    for (const result of denied) {
      expect(result).toMatchObject({ ok: false });
      expect(["FORBIDDEN", "UNAUTHENTICATED", "INVALID_INPUT"]).toContain((result as { kind: string }).kind);
    }
    expect(mocks.createDraftGenerateStore).not.toHaveBeenCalled();
    expect(store.calls).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});
