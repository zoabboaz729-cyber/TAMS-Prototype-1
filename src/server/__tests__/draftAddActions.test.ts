/**
 * M3-T2b3b — server action that exposes performDraftAdd() to the officer's
 * browser. The suite mocks next/headers, the session helper and the Prisma
 * store factory (the pattern established in draftMoveActions.test.ts) and
 * injects a fake add store that mirrors the transactional DRAFT re-check,
 * so every refusal is proven to reach zero persistence calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeUser } from "@/server/auth";
import type { DraftVersionRow } from "@/server/draftValidation";
import type { AddFields, AddAuditDraft, DraftAddStore } from "@/server/draftAdd";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createDraftAddStore: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/draftStorePrisma", () => ({
  createDraftAddStore: mocks.createDraftAddStore,
}));

import { addDraftEntryAction } from "@/app/officer/draft/actions";

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
// Fixtures — ids match the fake store's known teaching/venue lists
// ---------------------------------------------------------------------------

const TEST_VERSION_ID = "ver-test";

function makeVersion(status: DraftVersionRow["status"]): DraftVersionRow {
  return { id: TEST_VERSION_ID, semester: 1, status };
}

/** Valid add request: a new TUE 10:00-11:00 @ CR2 entry in the DRAFT. */
function addInput(overrides: Record<string, unknown> = {}) {
  return {
    versionId: TEST_VERSION_ID,
    teachingId: "teach-Y1CS101-1",
    venueId: "venue-CR2",
    day: "TUE",
    start: "10:00",
    end: "11:00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake store: implements DraftAddStore, mirrors the transactional version
// re-check, counts every call so denied requests are proven to trigger zero
// persistence.
// ---------------------------------------------------------------------------

type StoredEntry = { id: string; locked: boolean } & AddFields;

type AddCallCounts = {
  findVersion: number;
  findTeachingById: number;
  findVenueById: number;
  createEntry: number;
};

type FakeStore = {
  store: DraftAddStore;
  calls: AddCallCounts;
  entries: StoredEntry[];
  audit: AddAuditDraft[];
};

const KNOWN_TEACHING_IDS = ["teach-Y1CS101-1", "teach-Y2CS201-1"];
const KNOWN_VENUE_IDS = ["venue-CR1", "venue-CR2"];

function createFakeStore(options: {
  version?: DraftVersionRow;
  staleOnCreate?: boolean;
  failOn?: keyof AddCallCounts;
} = {}): FakeStore {
  const version = options.version ?? makeVersion("DRAFT");
  const calls: AddCallCounts = {
    findVersion: 0,
    findTeachingById: 0,
    findVenueById: 0,
    createEntry: 0,
  };
  const entries: StoredEntry[] = [];
  const audit: AddAuditDraft[] = [];

  function gate(name: keyof AddCallCounts) {
    calls[name] += 1;
    if (options.failOn === name) {
      throw new Error("column timetables.teachingId does not exist (internal detail)");
    }
  }

  const store: DraftAddStore = {
    findVersion(versionId) {
      gate("findVersion");
      return Promise.resolve(version.id === versionId ? version : null);
    },
    findTeachingById(teachingId) {
      gate("findTeachingById");
      return Promise.resolve(
        KNOWN_TEACHING_IDS.includes(teachingId) ? { id: teachingId } : null,
      );
    },
    findVenueById(venueId) {
      gate("findVenueById");
      return Promise.resolve(
        KNOWN_VENUE_IDS.includes(venueId) ? { id: venueId } : null,
      );
    },
    createEntry(fields, auditDraft) {
      gate("createEntry");
      if (options.staleOnCreate === true) {
        return Promise.resolve({ stale: true } as const);
      }
      // Mirror the transaction's re-check: the version must still exist and
      // still be DRAFT, or nothing is inserted.
      if (version.id !== fields.versionId || version.status !== "DRAFT") {
        return Promise.resolve({ stale: true } as const);
      }
      // The store assigns the id and always creates the row unlocked —
      // neither can come from the request.
      const id = `entry-added-${entries.length + 1}`;
      entries.push({ id, locked: false, ...fields });
      audit.push(auditDraft);
      return Promise.resolve({ ok: true, entryId: id } as const);
    },
  };

  return { store, calls, entries, audit };
}

let fake: FakeStore;

function sameOriginHeaders() {
  return new Headers({ origin: "http://localhost:3000", host: "localhost:3000" });
}

/** Replace the default fake with a specially-configured one. */
function installFake(specially: FakeStore) {
  vi.clearAllMocks();
  fake = specially;
  mocks.createDraftAddStore.mockReturnValue(specially.store);
  mocks.getCurrentUser.mockResolvedValue(officer);
  mocks.headers.mockResolvedValue(sameOriginHeaders());
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeStore();
  mocks.headers.mockResolvedValue(sameOriginHeaders());
  mocks.getCurrentUser.mockResolvedValue(officer);
  mocks.createDraftAddStore.mockReturnValue(fake.store);
});

describe("addDraftEntryAction", () => {
  it("performs an accepted add by an authenticated officer and persists it", async () => {
    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({
      ok: true,
      entryId: "entry-added-1",
      versionId: TEST_VERSION_ID,
    });
    expect(fake.entries).toEqual([
      {
        id: "entry-added-1",
        versionId: TEST_VERSION_ID,
        teachingId: "teach-Y1CS101-1",
        venueId: "venue-CR2",
        day: "TUE",
        start: "10:00",
        end: "11:00",
        locked: false,
      },
    ]);
    expect(fake.audit).toEqual([
      {
        actorId: officer.id,
        action: "TIMETABLE_ENTRY_ADD",
        reason:
          "Added entry to version ver-test: TUE 10:00-11:00 @ venue-CR2.",
      },
    ]);
  });

  it("returns only the created entry reference on success — never a conflict-free claim", async () => {
    const result = await addDraftEntryAction(addInput());

    // The editor must reload via loadDraftForValidation(); the action result
    // carries no validation state, so it cannot be read as "clean".
    expect(Object.keys(result).sort()).toEqual(["entryId", "ok", "versionId"]);
    expect(JSON.stringify(result)).not.toMatch(/valid|conflict|violat/i);
  });

  it("refuses with no session and creates no store", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(mocks.createDraftAddStore).not.toHaveBeenCalled();
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("rejects a cross-origin call before reading the session or the store", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: "http://attacker.example",
        host: "localhost:3000",
      }),
    );

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.createDraftAddStore).not.toHaveBeenCalled();
    expect(fake.calls.createEntry).toBe(0);
  });

  it.each([
    "STUDENT",
    "LECTURER",
    "DEPT_REP",
    "APPROVER",
    "ADMIN",
  ] as const)("refuses a %s caller with FORBIDDEN and zero restricted reads or writes", async (role) => {
    mocks.getCurrentUser.mockResolvedValue(userForRole(role));

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(fake.calls).toEqual({
      findVersion: 0,
      findTeachingById: 0,
      findVenueById: 0,
      createEntry: 0,
    });
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it.each([
    ["id", "entry-attacker"],
    ["locked", true],
    ["actorId", "attacker"],
    ["userId", "attacker"],
    ["role", "OFFICER"],
    ["status", "PUBLISHED"],
    ["createdBy", "attacker"],
    ["entryId", "e1"],
  ])("rejects a payload carrying the forged field %s as INVALID_INPUT", async (key, value) => {
    const result = await addDraftEntryAction(addInput({ [key]: value }));

    expect(result).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(mocks.createDraftAddStore).not.toHaveBeenCalled();
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("keeps the session identity authoritative for an officer even when actor fields are forged", async () => {
    // Same payload as the refused case — proves the refusal is about the
    // forged keys, and that a clean payload from the same session still
    // audits against the session user, never a payload id.
    const forged = await addDraftEntryAction(addInput({ userId: "attacker" }));
    expect(forged).toMatchObject({ ok: false, kind: "INVALID_INPUT" });

    const clean = await addDraftEntryAction(addInput());
    expect(clean).toMatchObject({ ok: true });
    expect(fake.audit[0]?.actorId).toBe(officer.id);
  });

  it("rejects non-string field values at the boundary before any store exists", async () => {
    const numericDay = await addDraftEntryAction(addInput({ day: 17 }));
    const numericStart = await addDraftEntryAction(addInput({ start: 1000 }));

    expect(numericDay).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(numericStart).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(mocks.createDraftAddStore).not.toHaveBeenCalled();
    expect(fake.calls.createEntry).toBe(0);
  });

  it("propagates INVALID_INPUT from the service for malformed schedules without reading or writing", async () => {
    const badDay = await addDraftEntryAction(addInput({ day: "SATURDAY" }));
    const badTime = await addDraftEntryAction(addInput({ start: "8am" }));
    const reversed = await addDraftEntryAction(
      addInput({ start: "11:00", end: "10:00" }),
    );
    const blankVersion = await addDraftEntryAction(addInput({ versionId: "   " }));

    expect(badDay).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(badTime).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(reversed).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expect(blankVersion).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    // Semantic validation runs in the service before any restricted read.
    expect(fake.calls).toEqual({
      findVersion: 0,
      findTeachingById: 0,
      findVenueById: 0,
      createEntry: 0,
    });
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates VERSION_NOT_FOUND for an unknown version without reading further or writing", async () => {
    const result = await addDraftEntryAction(
      addInput({ versionId: "ver-does-not-exist" }),
    );

    expect(result).toEqual({ ok: false, kind: "VERSION_NOT_FOUND" });
    expect(fake.calls.findVersion).toBe(1);
    expect(fake.calls.findTeachingById).toBe(0);
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates TEACHING_NOT_FOUND for an unknown teaching without checking the venue or writing", async () => {
    const result = await addDraftEntryAction(
      addInput({ teachingId: "teach-deleted" }),
    );

    expect(result).toEqual({ ok: false, kind: "TEACHING_NOT_FOUND" });
    expect(fake.calls.findTeachingById).toBe(1);
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates VENUE_NOT_FOUND for an unknown venue without writing", async () => {
    const result = await addDraftEntryAction(addInput({ venueId: "venue-demolished" }));

    expect(result).toEqual({ ok: false, kind: "VENUE_NOT_FOUND" });
    expect(fake.calls.findVenueById).toBe(1);
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it.each(["PUBLISHED", "ARCHIVED"] as const)("propagates NOT_DRAFT with the stored status for a %s version", async (storedStatus) => {
    installFake(createFakeStore({ version: makeVersion(storedStatus) }));

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus,
    });
    expect(fake.calls.findTeachingById).toBe(0);
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it("propagates STALE when the version changes inside the transaction, persisting nothing", async () => {
    installFake(createFakeStore({ staleOnCreate: true }));

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "STALE" });
    expect(fake.calls.createEntry).toBe(1);
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it.each(["findVersion", "createEntry"] as const)("returns a safe INTERNAL_ERROR when the store fails on %s, hiding database details", async (failOn) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installFake(createFakeStore({ failOn }));

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("does not exist");
    expect(fake.entries).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
    // The log receives the message only, never the Error object or a payload.
    const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("does not exist");
    expect(logged).not.toContain(JSON.stringify(addInput()));
    errorLog.mockRestore();
  });

  it("returns a safe INTERNAL_ERROR when the store factory itself throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createDraftAddStore.mockImplementation(() => {
      throw new Error("connection string leaked (internal detail)");
    });

    const result = await addDraftEntryAction(addInput());

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("connection string");
    expect(fake.calls.createEntry).toBe(0);
    errorLog.mockRestore();
  });
});
