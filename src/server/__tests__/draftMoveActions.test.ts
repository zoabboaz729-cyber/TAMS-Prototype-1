/**
 * M3-T2c1 — server action that exposes performDraftMove() to the officer's
 * browser. The suite mocks next/headers, the session helper and the Prisma
 * store factory (the pattern established in submissionActions.test.ts) and
 * injects a fake move store that mirrors the real compare-and-set, so every
 * refusal is proven to reach zero persistence calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeUser } from "@/server/auth";
import type {
  DraftEntryRow,
  DraftVersionRow,
} from "@/server/draftValidation";
import type { DraftMoveStore, MoveAuditDraft } from "@/server/draftMove";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createDraftMoveStore: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/draftStorePrisma", () => ({
  createDraftMoveStore: mocks.createDraftMoveStore,
}));

import { moveDraftEntryAction } from "@/app/officer/draft/actions";

// ---------------------------------------------------------------------------
// Session users
// ---------------------------------------------------------------------------

const officer: SafeUser = {
  id: "user-officer",
  name: "Timetabling Officer",
  email: "officer@demo.tams.test",
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};

function userForRole(role: SafeUser["role"]): SafeUser {
  return {
    id: `user-${role.toLowerCase()}`,
    name: `${role} user`,
    email: `${role.toLowerCase()}@demo.tams.test`,
    role,
    departmentId: null,
    studentGroupId: null,
  };
}

// ---------------------------------------------------------------------------
// Fixture rows — the standard moved entry matches draftMove.test.ts
// ---------------------------------------------------------------------------

const TEST_VERSION_ID = "ver-test";

function makeVersion(status: DraftVersionRow["status"]): DraftVersionRow {
  return { id: TEST_VERSION_ID, semester: 1, status };
}

function makeEntry(overrides: Partial<DraftEntryRow> = {}): DraftEntryRow {
  return {
    id: "e1",
    versionId: TEST_VERSION_ID,
    teachingId: "teach-Y1CS101-1",
    venueId: "venue-CR1",
    day: "MON",
    start: "08:00",
    end: "09:00",
    locked: false,
    ...overrides,
  };
}

/** Valid move request: MON 08:00-09:00 @ CR1 → TUE 10:00-11:00 @ CR2. */
function moveInput(overrides: Record<string, unknown> = {}) {
  return {
    versionId: TEST_VERSION_ID,
    entryId: "e1",
    day: "TUE",
    start: "10:00",
    end: "11:00",
    venueId: "venue-CR2",
    expectedDay: "MON",
    expectedStart: "08:00",
    expectedEnd: "09:00",
    expectedVenueId: "venue-CR1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake store: implements DraftMoveStore, mirrors the compare-and-set, counts
// every call so denied requests are proven to trigger zero persistence.
// ---------------------------------------------------------------------------

type MoveCallCounts = {
  findVersion: number;
  findEntry: number;
  findVenueById: number;
  moveEntry: number;
};

type FakeStore = {
  store: DraftMoveStore;
  calls: MoveCallCounts;
  entries: DraftEntryRow[];
  audit: MoveAuditDraft[];
};

function createFakeStore(options: {
  version?: DraftVersionRow;
  entry?: DraftEntryRow | null;
  staleOnMove?: boolean;
  failOn?: keyof MoveCallCounts;
} = {}): FakeStore {
  const entries = options.entry === null ? [] : [options.entry ?? makeEntry()];
  const version = options.version ?? makeVersion("DRAFT");
  const calls: MoveCallCounts = {
    findVersion: 0,
    findEntry: 0,
    findVenueById: 0,
    moveEntry: 0,
  };
  const audit: MoveAuditDraft[] = [];

  function gate(name: keyof MoveCallCounts) {
    calls[name] += 1;
    if (options.failOn === name) {
      throw new Error("column timetables.entry does not exist (internal detail)");
    }
  }

  const store: DraftMoveStore = {
    findVersion(versionId) {
      gate("findVersion");
      return Promise.resolve(version.id === versionId ? version : null);
    },
    findEntry(entryId) {
      gate("findEntry");
      const entry = entries.find((candidate) => candidate.id === entryId);
      return Promise.resolve(entry ? { ...entry } : null);
    },
    findVenueById(venueId) {
      gate("findVenueById");
      return Promise.resolve(
        venueId === "venue-CR1" || venueId === "venue-CR2" ? { id: venueId } : null,
      );
    },
    moveEntry(entryId, expectedVersionId, fields, auditDraft) {
      gate("moveEntry");
      if (options.staleOnMove === true) {
        return Promise.resolve({ stale: true } as const);
      }
      const entry = entries.find(
        (candidate) =>
          candidate.id === entryId &&
          candidate.versionId === expectedVersionId &&
          !candidate.locked &&
          candidate.day === fields.expectedDay &&
          candidate.start === fields.expectedStart &&
          candidate.end === fields.expectedEnd &&
          candidate.venueId === fields.expectedVenueId,
      );
      if (entry === undefined) {
        return Promise.resolve({ stale: true } as const);
      }
      entry.day = fields.day;
      entry.start = fields.start;
      entry.end = fields.end;
      entry.venueId = fields.venueId;
      audit.push(auditDraft);
      return Promise.resolve({ ok: true } as const);
    },
  };

  return { store, calls, entries, audit };
}

let fake: FakeStore;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeStore();
  mocks.headers.mockResolvedValue(
    new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    }),
  );
  mocks.getCurrentUser.mockResolvedValue(officer);
  mocks.createDraftMoveStore.mockReturnValue(fake.store);
});

describe("moveDraftEntryAction", () => {
  it("performs an accepted move by an authenticated officer and persists it", async () => {
    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({
      ok: true,
      entryId: "e1",
      versionId: TEST_VERSION_ID,
    });
    expect(fake.entries[0]).toMatchObject({
      day: "TUE",
      start: "10:00",
      end: "11:00",
      venueId: "venue-CR2",
    });
    expect(fake.audit).toEqual([
      {
        actorId: officer.id,
        action: "TIMETABLE_ENTRY_MOVE",
        reason:
          "Moved from MON 08:00-09:00 @ venue-CR1 to TUE 10:00-11:00 @ venue-CR2.",
      },
    ]);
  });

  it("returns only the moved entry reference on success — never a conflict-free claim", async () => {
    const result = await moveDraftEntryAction(moveInput());

    // The editor must reload via loadDraftForValidation(); the action result
    // carries no validation state, so it cannot be read as "clean".
    expect(Object.keys(result).sort()).toEqual(["entryId", "ok", "versionId"]);
    expect(JSON.stringify(result)).not.toMatch(/valid|conflict|violat/i);
  });

  it("refuses with no session and creates no store", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(mocks.createDraftMoveStore).not.toHaveBeenCalled();
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it.each([
    "STUDENT",
    "LECTURER",
    "DEPT_REP",
    "APPROVER",
    "ADMIN",
  ] as const)("refuses a %s caller with FORBIDDEN and zero store calls", async (role) => {
    mocks.getCurrentUser.mockResolvedValue(userForRole(role));

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(fake.calls).toEqual({
      findVersion: 0,
      findEntry: 0,
      findVenueById: 0,
      moveEntry: 0,
    });
    expect(fake.entries[0]).toMatchObject({ day: "MON", start: "08:00" });
    expect(fake.audit).toHaveLength(0);
  });

  it("rejects a cross-origin call before reading the session or the store", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: "http://attacker.example",
        host: "localhost:3000",
      }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.createDraftMoveStore).not.toHaveBeenCalled();
    expect(fake.calls.moveEntry).toBe(0);
  });

  it.each([
    ["role", "OFFICER"],
    ["userId", "attacker"],
    ["actorId", "attacker"],
    ["id", "attacker"],
    ["departmentId", "dept-computing"],
    ["locked", true],
    ["teachingId", "teach-other"],
    ["status", "PUBLISHED"],
  ])("rejects a payload carrying the forged field %s as INVALID_INPUT", async (key, value) => {
    const result = await moveDraftEntryAction(moveInput({ [key]: value }));

    expect(result).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(mocks.createDraftMoveStore).not.toHaveBeenCalled();
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("keeps the session identity authoritative for an officer even when actor fields are forged", async () => {
    // Same payload as the refused case — proves the refusal is about the
    // forged keys, and that a clean payload from the same session still
    // audits against the session user, never a payload id.
    const forged = await moveDraftEntryAction(moveInput({ userId: "attacker" }));
    expect(forged).toMatchObject({ ok: false, kind: "INVALID_INPUT" });

    const clean = await moveDraftEntryAction(moveInput());
    expect(clean).toMatchObject({ ok: true });
    expect(fake.audit[0]?.actorId).toBe(officer.id);
  });

  it("propagates INVALID_INPUT from the service for malformed schedules without persisting", async () => {
    const badDay = await moveDraftEntryAction(moveInput({ day: "SATURDAY" }));
    const badTime = await moveDraftEntryAction(moveInput({ start: "8am" }));
    const reversed = await moveDraftEntryAction(
      moveInput({ start: "11:00", end: "10:00" }),
    );
    const blankId = await moveDraftEntryAction(moveInput({ entryId: "   " }));

    expect(badDay).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(badTime).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(reversed).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(blankId).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.entries[0]).toMatchObject({ day: "MON", venueId: "venue-CR1" });
    expect(fake.audit).toHaveLength(0);
  });

  it("rejects non-string field values at the boundary before any store exists", async () => {
    const result = await moveDraftEntryAction(moveInput({ day: 17 }));

    expect(result).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(mocks.createDraftMoveStore).not.toHaveBeenCalled();
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("propagates STALE when the expected previous schedule no longer matches, writing nothing", async () => {
    const result = await moveDraftEntryAction(moveInput({ expectedStart: "09:00" }));

    expect(result).toEqual({ ok: false, kind: "STALE" });
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.entries[0]).toMatchObject({ day: "MON", start: "08:00", venueId: "venue-CR1" });
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates STALE when the compare-and-set fails inside the store", async () => {
    vi.clearAllMocks();
    fake = createFakeStore({ staleOnMove: true });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "STALE" });
    expect(fake.calls.moveEntry).toBe(1);
    expect(fake.audit).toHaveLength(0);
    expect(fake.entries[0]).toMatchObject({ day: "MON", venueId: "venue-CR1" });
  });

  it("propagates ENTRY_LOCKED without touching the locked entry", async () => {
    vi.clearAllMocks();
    fake = createFakeStore({ entry: makeEntry({ locked: true }) });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "ENTRY_LOCKED" });
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates NOT_DRAFT with the stored status for a published version", async () => {
    vi.clearAllMocks();
    fake = createFakeStore({ version: makeVersion("PUBLISHED") });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus: "PUBLISHED",
    });
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates VERSION_NOT_FOUND for an unknown version without writing", async () => {
    vi.clearAllMocks();
    fake = createFakeStore({ version: makeVersion("DRAFT") });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(
      moveInput({ versionId: "ver-does-not-exist" }),
    );

    expect(result).toEqual({ ok: false, kind: "VERSION_NOT_FOUND" });
    expect(fake.calls.findEntry).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates ENTRY_NOT_FOUND for an unknown entry without writing", async () => {
    vi.clearAllMocks();
    fake = createFakeStore({ entry: null });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "ENTRY_NOT_FOUND" });
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("returns a safe INTERNAL_ERROR when the store fails, hiding database details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.clearAllMocks();
    fake = createFakeStore({ failOn: "findVersion" });
    mocks.createDraftMoveStore.mockReturnValue(fake.store);
    mocks.getCurrentUser.mockResolvedValue(officer);
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("does not exist");
    expect(fake.calls.moveEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
    // The log receives the message only, never the Error object or a payload.
    const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("does not exist");
    expect(logged).not.toContain(JSON.stringify(moveInput()));
    errorLog.mockRestore();
  });

  it("returns a safe INTERNAL_ERROR when the store factory itself throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createDraftMoveStore.mockImplementation(() => {
      throw new Error("connection string leaked (internal detail)");
    });

    const result = await moveDraftEntryAction(moveInput());

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("connection string");
    expect(fake.calls.moveEntry).toBe(0);
    errorLog.mockRestore();
  });
});
