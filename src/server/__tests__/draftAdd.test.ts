/**
 * M3-T2b3a — server-side add of one new entry to a DRAFT timetable version.
 *
 * Two suites. (1) Fake-store suite: the store is the injected interface, so
 * every case runs against database-shaped rows built from the real seed data.
 * The fake implements BOTH DraftAddStore and DraftValidationStore, applies the
 * same transactional re-check as the Prisma adapter (version still exists and
 * is DRAFT) and counts calls, so an unauthorised or invalid request is proven
 * to trigger zero reads and a stale add is proven to persist nothing.
 * (2) Isolated-database suite: a temporary SQLite file (never prisma/dev.db)
 * with the real schema, running the real Prisma adapter and its transaction
 * against real stored rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PrismaClient } from "@prisma/client";
import {
  seedLecturerAvailabilities,
  seedTeachings,
  seedUnits,
  seedVenueUnavailabilities,
  seedVenues,
} from "@/domain/seedData";
import type { Actor } from "@/domain/permissions";
import type { UserRole } from "@/domain/types";
import type { Violation } from "@/domain/validator";
import { loadDraftForValidation } from "@/server/draftValidation";
import type {
  DraftEntryRow,
  DraftValidationStore,
  DraftVersionRow,
  LecturerUnavailableRow,
  TeachingRow,
  VenueRow,
  VenueUnavailableRow,
} from "@/server/draftValidation";
import { performDraftAdd } from "@/server/draftAdd";
import type {
  AddAuditDraft,
  AddFields,
  DraftAddRequest,
  DraftAddResult,
  DraftAddStore,
} from "@/server/draftAdd";
import { createDraftAddStore } from "@/server/draftStorePrisma";

// ---------------------------------------------------------------------------
// Seed rows reshaped as the store returns (mirrors draftMove.test.ts)
// ---------------------------------------------------------------------------

const seedTeachingRows: TeachingRow[] = seedTeachings.flatMap((teaching) => {
  const unit = seedUnits.find((candidate) => candidate.id === teaching.unitId);
  if (unit === undefined) {
    throw new Error(`seed teaching ${teaching.id} has no seeded unit`);
  }
  return [
    {
      id: teaching.id,
      lecturerId: teaching.lecturerId,
      groupId: teaching.groupId,
      expectedSize: teaching.expectedSize,
      unitCode: unit.code,
      venueTypeRequired: unit.venueTypeRequired,
    },
  ];
});

const seedVenueRows: VenueRow[] = seedVenues.map((venue) => ({
  id: venue.id,
  code: venue.code,
  capacity: venue.capacity,
  type: venue.type,
}));

const seedLecturerUnavailableRows: LecturerUnavailableRow[] =
  seedLecturerAvailabilities.map((availability) => ({
    id: availability.id,
    lecturerId: availability.lecturerId,
    day: availability.day,
    start: availability.start,
    end: availability.end,
    available: availability.available,
  }));

const seedVenueUnavailableRows: VenueUnavailableRow[] = seedVenueUnavailabilities.map(
  (unavailable) => ({
    id: unavailable.id,
    venueId: unavailable.venueId,
    day: unavailable.day,
    start: unavailable.start,
    end: unavailable.end,
    reason: unavailable.reason,
  }),
);

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

const TEST_VERSION_ID = "ver-test";
const OFFICER_ID = "user-officer";

function makeVersion(status: DraftVersionRow["status"]): DraftVersionRow {
  return { id: TEST_VERSION_ID, semester: 1, status };
}

function makeEntry(
  id: string,
  teachingId: string,
  venueId: string,
  day: string,
  start: string,
  end: string,
  overrides: Partial<DraftEntryRow> = {},
): DraftEntryRow {
  return {
    id,
    versionId: TEST_VERSION_ID,
    teachingId,
    venueId,
    day,
    start,
    end,
    locked: false,
    ...overrides,
  };
}

/** A clean officer actor with no department or group. */
const officer: Actor = {
  id: OFFICER_ID,
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};

const forbiddenRoles: UserRole[] = [
  "STUDENT",
  "LECTURER",
  "DEPT_REP",
  "APPROVER",
  "ADMIN",
];

function actorFor(role: UserRole): Actor {
  const id = `user-${role.toLowerCase()}`;
  return { id, role, departmentId: null, studentGroupId: null };
}

function addRequest(overrides: Partial<DraftAddRequest> = {}): DraftAddRequest {
  return {
    versionId: TEST_VERSION_ID,
    teachingId: "teach-SE-Y4-SOEN413",
    venueId: "venue-CR2",
    day: "TUE",
    start: "10:00",
    end: "11:00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake store: implements DraftAddStore & DraftValidationStore
// ---------------------------------------------------------------------------

type FakeData = {
  versions: DraftVersionRow[];
  entries: DraftEntryRow[];
  teachings: TeachingRow[];
  venues: VenueRow[];
  lecturerUnavailable: LecturerUnavailableRow[];
  venueUnavailable: VenueUnavailableRow[];
  audit: AddAuditDraft[];
};

const STORE_METHODS = [
  "findVersion",
  "findTeachingById",
  "findVenueById",
  "createEntry",
  "listEntriesByVersion",
  "listTeachingsByIds",
  "listVenuesByIds",
  "listLecturerUnavailableByLecturerIds",
  "listVenueUnavailableByVenueIds",
] as const;

type StoreMethod = (typeof STORE_METHODS)[number];

function baseData(entries: DraftEntryRow[]): FakeData {
  return {
    versions: [makeVersion("DRAFT")],
    entries,
    teachings: seedTeachingRows,
    venues: seedVenueRows,
    lecturerUnavailable: seedLecturerUnavailableRows,
    venueUnavailable: seedVenueUnavailableRows,
    audit: [],
  };
}

type FakeStore = {
  store: DraftAddStore & DraftValidationStore;
  calls: Record<StoreMethod, number>;
  data: FakeData;
  totalCalls: number;
};

function createFakeStore(
  data: FakeData,
  options: { staleOnAdd?: boolean; failOn?: StoreMethod } = {},
): FakeStore {
  const calls = Object.fromEntries(STORE_METHODS.map((name) => [name, 0])) as Record<
    StoreMethod,
    number
  >;
  let nextEntryNumber = 0;

  function record<T>(name: StoreMethod, value: T): T {
    calls[name] += 1;
    if (options.failOn === name) {
      throw new Error(`simulated database failure in ${name}`);
    }
    return value;
  }

  const store: DraftAddStore & DraftValidationStore = {
    // --- add store ---
    findVersion(versionId) {
      return Promise.resolve(
        record(
          "findVersion",
          data.versions.find((version) => version.id === versionId) ?? null,
        ),
      );
    },
    findTeachingById(teachingId) {
      const teaching = data.teachings.find((candidate) => candidate.id === teachingId) ?? null;
      return Promise.resolve(record("findTeachingById", teaching === null ? null : { id: teaching.id }));
    },
    findVenueById(venueId) {
      const venue = data.venues.find((candidate) => candidate.id === venueId) ?? null;
      return Promise.resolve(record("findVenueById", venue === null ? null : { id: venue.id }));
    },
    createEntry(fields, audit) {
      // Count (and fail when configured) BEFORE any mutation, so a simulated
      // store failure cannot leave a half-applied write behind in the fake.
      record("createEntry", undefined);
      if (options.staleOnAdd === true) {
        // Simulates the version being published or removed between the
        // pre-checks and the transactional re-check.
        return Promise.resolve({ stale: true } as const);
      }
      // Real in-memory re-check, mirroring the Prisma transaction: the
      // version must still exist and still be DRAFT.
      const version = data.versions.find((candidate) => candidate.id === fields.versionId);
      if (version === undefined || version.status !== "DRAFT") {
        return Promise.resolve({ stale: true } as const);
      }
      // Insert a brand-new row only — no existing entry is touched. The id
      // is generated by the store, never taken from the request.
      nextEntryNumber += 1;
      const entryId = `added-${nextEntryNumber}`;
      data.entries.push({
        id: entryId,
        versionId: fields.versionId,
        teachingId: fields.teachingId,
        venueId: fields.venueId,
        day: fields.day,
        start: fields.start,
        end: fields.end,
        locked: false,
      });
      data.audit.push(audit);
      return Promise.resolve({ ok: true, entryId } as const);
    },

    // --- validation store (for the clash test's subsequent validation) ---
    listEntriesByVersion(versionId) {
      return Promise.resolve(
        record(
          "listEntriesByVersion",
          data.entries.filter((entry) => entry.versionId === versionId),
        ),
      );
    },
    listTeachingsByIds(teachingIds) {
      return Promise.resolve(
        record(
          "listTeachingsByIds",
          data.teachings.filter((teaching) => teachingIds.includes(teaching.id)),
        ),
      );
    },
    listVenuesByIds(venueIds) {
      return Promise.resolve(
        record("listVenuesByIds", data.venues.filter((venue) => venueIds.includes(venue.id))),
      );
    },
    listLecturerUnavailableByLecturerIds(lecturerIds) {
      return Promise.resolve(
        record(
          "listLecturerUnavailableByLecturerIds",
          data.lecturerUnavailable.filter((row) => lecturerIds.includes(row.lecturerId)),
        ),
      );
    },
    listVenueUnavailableByVenueIds(venueIds) {
      return Promise.resolve(
        record(
          "listVenueUnavailableByVenueIds",
          data.venueUnavailable.filter((row) => venueIds.includes(row.venueId)),
        ),
      );
    },
  };

  return {
    store,
    calls,
    data,
    get totalCalls() {
      return STORE_METHODS.reduce((total, name) => total + calls[name], 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function expectAdded(result: DraftAddResult): Extract<DraftAddResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a successful add, got ${result.kind}`);
  }
  return result;
}

function findEntry(data: FakeData, entryId: string): DraftEntryRow {
  const entry = data.entries.find((candidate) => candidate.id === entryId);
  if (entry === undefined) {
    throw new Error(`entry ${entryId} not found in fake store`);
  }
  return entry;
}

function violationTypes(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.type);
}

function standardEntries(): DraftEntryRow[] {
  return [makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")];
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("performDraftAdd authorization", () => {
  it("refuses a null actor with UNAUTHENTICATED and zero store calls", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(fake.store, null, addRequest());

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(fake.totalCalls).toBe(0);
  });

  for (const role of forbiddenRoles) {
    it(`refuses ${role} with FORBIDDEN and zero restricted reads`, async () => {
      const fake = createFakeStore(baseData(standardEntries()));
      const result = await performDraftAdd(fake.store, actorFor(role), addRequest());

      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expect(fake.totalCalls).toBe(0);
    });
  }

  it("allows the officer through (EDIT_DRAFT is ALL-scoped)", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(fake.store, officer, addRequest());

    expectAdded(result);
  });
});

// ---------------------------------------------------------------------------
// Input validation — every case must read nothing
// ---------------------------------------------------------------------------

describe("performDraftAdd input validation", () => {
  async function expectInvalid(overrides: Partial<DraftAddRequest>, message: string) {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(fake.store, officer, addRequest(overrides));

    expect(result).toEqual({ ok: false, kind: "INVALID_INPUT", message });
    expect(fake.totalCalls).toBe(0);
    expect(fake.data.entries).toHaveLength(1);
    expect(fake.data.audit).toHaveLength(0);
  }

  it("rejects a day outside MON-FRI", async () => {
    await expectInvalid({ day: "SAT" }, "Day must be one of MON, TUE, WED, THU, FRI.");
    await expectInvalid({ day: "mon" }, "Day must be one of MON, TUE, WED, THU, FRI.");
  });

  it("rejects malformed times", async () => {
    await expectInvalid({ start: "8am" }, "Time must be in HH:MM format (00:00-23:59).");
    await expectInvalid({ start: "24:00" }, "Time must be in HH:MM format (00:00-23:59).");
    await expectInvalid({ end: "9:00" }, "Time must be in HH:MM format (00:00-23:59).");
  });

  it("rejects a start that is not before the end", async () => {
    await expectInvalid(
      { start: "10:00", end: "10:00" },
      "Start time must be before end time.",
    );
    await expectInvalid(
      { start: "11:00", end: "10:00" },
      "Start time must be before end time.",
    );
  });

  it("rejects missing or blank id fields with the schema's own message", async () => {
    await expectInvalid({ versionId: "" }, "Version id is required");
    await expectInvalid({ versionId: "   " }, "Version id is required");
    await expectInvalid({ teachingId: "" }, "Teaching id is required");
    await expectInvalid({ venueId: "" }, "Venue id is required");
  });

  it("never lets a forged key decide the entry's fields", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    // A browser that adds `locked`, `id` or `versionId` overrides beyond the
    // six accepted keys: the service reads only the six, and the created row
    // carries store-generated id and locked:false.
    const forged = {
      ...addRequest(),
      locked: true,
      id: "evil-id",
    } as DraftAddRequest;
    const result = expectAdded(await performDraftAdd(fake.store, officer, forged));

    const entry = findEntry(fake.data, result.entryId);
    expect(entry.locked).toBe(false);
    expect(entry.id).toBe("added-1");
    expect(entry.versionId).toBe(TEST_VERSION_ID);
  });
});

// ---------------------------------------------------------------------------
// Record resolution: version, teaching, venue
// ---------------------------------------------------------------------------

describe("performDraftAdd record resolution", () => {
  it("refuses a missing version with VERSION_NOT_FOUND and no further reads", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(fake.store, officer, addRequest({ versionId: "ver-ghost" }));

    expect(result).toEqual({ ok: false, kind: "VERSION_NOT_FOUND" });
    expect(fake.calls.findVersion).toBe(1);
    expect(fake.calls.findTeachingById).toBe(0);
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.createEntry).toBe(0);
  });

  it("refuses a PUBLISHED version with NOT_DRAFT and writes nothing", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    fake.data.versions[0] = makeVersion("PUBLISHED");
    const result = await performDraftAdd(fake.store, officer, addRequest());

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus: "PUBLISHED",
    });
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.data.entries).toHaveLength(1);
    expect(fake.data.audit).toHaveLength(0);
  });

  it("refuses an ARCHIVED version with NOT_DRAFT and writes nothing", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    fake.data.versions[0] = makeVersion("ARCHIVED");
    const result = await performDraftAdd(fake.store, officer, addRequest());

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus: "ARCHIVED",
    });
    expect(fake.calls.createEntry).toBe(0);
    expect(fake.data.audit).toHaveLength(0);
  });

  it("refuses a missing teaching with TEACHING_NOT_FOUND before the venue read", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(
      fake.store,
      officer,
      addRequest({ teachingId: "teach-ghost" }),
    );

    expect(result).toEqual({ ok: false, kind: "TEACHING_NOT_FOUND" });
    expect(fake.calls.findTeachingById).toBe(1);
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.createEntry).toBe(0);
  });

  it("refuses a missing venue with VENUE_NOT_FOUND and writes nothing", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = await performDraftAdd(fake.store, officer, addRequest({ venueId: "venue-ghost" }));

    expect(result).toEqual({ ok: false, kind: "VENUE_NOT_FOUND" });
    expect(fake.calls.findVenueById).toBe(1);
    expect(fake.calls.createEntry).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

describe("performDraftAdd success", () => {
  it("inserts a new unlocked row with a store-generated id and writes one audit row", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const result = expectAdded(
      await performDraftAdd(
        fake.store,
        officer,
        addRequest({ day: "WED", start: "09:00", end: "10:00", venueId: "venue-GR1" }),
      ),
    );

    expect(result.versionId).toBe(TEST_VERSION_ID);
    expect(result.entryId).toBe("added-1");
    // The success object is exactly ok/entryId/versionId — it cannot and does
    // not describe the draft as conflict-free (requirement #12).
    expect(Object.keys(result).sort()).toEqual(["entryId", "ok", "versionId"]);

    const entry = findEntry(fake.data, "added-1");
    expect(entry).toEqual({
      id: "added-1",
      versionId: TEST_VERSION_ID,
      teachingId: "teach-SE-Y4-SOEN413",
      venueId: "venue-GR1",
      day: "WED",
      start: "09:00",
      end: "10:00",
      locked: false,
    });

    // The pre-existing entry is preserved untouched.
    expect(findEntry(fake.data, "e1")).toEqual(
      makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00"),
    );

    expect(fake.data.audit).toHaveLength(1);
    expect(fake.data.audit[0].actorId).toBe(OFFICER_ID);
    expect(fake.data.audit[0].action).toBe("TIMETABLE_ENTRY_ADD");
    expect(fake.data.audit[0].reason).toContain("WED 09:00-10:00");
    expect(fake.data.audit[0].reason).toContain("@ venue-GR1");
  });

  it("supports repeated adds, each getting its own id", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    const first = expectAdded(await performDraftAdd(fake.store, officer, addRequest()));
    const second = expectAdded(
      await performDraftAdd(fake.store, officer, addRequest({ day: "FRI", start: "14:00", end: "15:00" })),
    );

    expect(first.entryId).toBe("added-1");
    expect(second.entryId).toBe("added-2");
    expect(fcount(fake)).toBe(3);
    expect(fake.data.audit).toHaveLength(2);
  });

  it("never reads or rewrites another version's entries", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    // A row belonging to a different version must not appear or change.
    fake.data.entries.push(
      makeEntry("other", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00", {
        versionId: "ver-other",
      }),
    );
    expectAdded(await performDraftAdd(fake.store, officer, addRequest()));

    expect(findEntry(fake.data, "other")).toEqual(
      makeEntry("other", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00", {
        versionId: "ver-other",
      }),
    );
    expect(fake.calls.listEntriesByVersion).toBe(0);
  });
});

function fcount(fake: FakeStore): number {
  return fake.data.entries.length;
}

// ---------------------------------------------------------------------------
// Stale: version published/removed between pre-check and transaction
// ---------------------------------------------------------------------------

describe("performDraftAdd stale state", () => {
  it("returns STALE when the transaction finds the version no longer DRAFT", async () => {
    const fake = createFakeStore(baseData(standardEntries()), { staleOnAdd: true });
    const result = await performDraftAdd(fake.store, officer, addRequest());

    expect(result).toEqual({ ok: false, kind: "STALE" });
    // Nothing was persisted: no new row, no audit.
    expect(fake.data.entries).toHaveLength(1);
    expect(fake.data.audit).toHaveLength(0);
    expect(fake.calls.createEntry).toBe(1);
  });

  it("the store's own re-check refuses an insert into a published version", async () => {
    // Direct adapter-level compare, mirroring the Prisma transaction: even if
    // a caller skips the service, createEntry will not insert into non-DRAFT.
    const fake = createFakeStore(baseData(standardEntries()));
    fake.data.versions[0] = makeVersion("PUBLISHED");
    const fields: AddFields = {
      versionId: TEST_VERSION_ID,
      teachingId: "teach-SE-Y4-SOEN413",
      venueId: "venue-CR2",
      day: "TUE",
      start: "10:00",
      end: "11:00",
    };
    const audit: AddAuditDraft = {
      actorId: OFFICER_ID,
      action: "TIMETABLE_ENTRY_ADD",
      reason: "direct store call",
    };

    const result = await fake.store.createEntry(fields, audit);
    expect(result).toEqual({ stale: true });
    expect(fake.data.entries).toHaveLength(1);
    expect(fake.data.audit).toHaveLength(0);
  });

  it("the store's own re-check refuses an insert into a removed version", async () => {
    const fake = createFakeStore(baseData(standardEntries()));
    fake.data.versions = [];
    const result = await fake.store.createEntry(
      {
        versionId: TEST_VERSION_ID,
        teachingId: "teach-SE-Y4-SOEN413",
        venueId: "venue-CR2",
        day: "TUE",
        start: "10:00",
        end: "11:00",
      },
      { actorId: OFFICER_ID, action: "TIMETABLE_ENTRY_ADD", reason: "direct store call" },
    );
    expect(result).toEqual({ stale: true });
    expect(fake.data.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Store failures
// ---------------------------------------------------------------------------

describe("performDraftAdd store failures", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  async function expectInternalError(failOn: StoreMethod) {
    const fake = createFakeStore(baseData(standardEntries()), { failOn });
    const result = await performDraftAdd(fake.store, officer, addRequest());

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(fake.data.entries).toHaveLength(1);
    expect(fake.data.audit).toHaveLength(0);
  }

  it("turns a findVersion failure into INTERNAL_ERROR, never a clean result", async () => {
    await expectInternalError("findVersion");
  });

  it("turns a findTeachingById failure into INTERNAL_ERROR", async () => {
    await expectInternalError("findTeachingById");
  });

  it("turns a findVenueById failure into INTERNAL_ERROR", async () => {
    await expectInternalError("findVenueById");
  });

  it("turns a createEntry failure into INTERNAL_ERROR", async () => {
    await expectInternalError("createEntry");
  });

  it("logs only the error message", async () => {
    const fake = createFakeStore(baseData(standardEntries()), { failOn: "createEntry" });
    await performDraftAdd(fake.store, officer, addRequest());

    expect(console.error).toHaveBeenCalledWith(
      "[draftAdd] add failed:",
      "simulated database failure in createEntry",
    );
  });
});

// ---------------------------------------------------------------------------
// Deliberate clash + subsequent validation (requirement #12)
// ---------------------------------------------------------------------------

describe("performDraftAdd a deliberate clash", () => {
  /**
   * Entry A: teach-CS-Y2-CS202 (lecturer-C, group-CS-Y2), CR1, WED 09:00-10:00.
   * Entry B: teach-SE-Y4-SOEN415 (lecturer-B, group-SE-Y4), CR2, THU 10:00-11:00.
   * The draft is clean before the add.
   */
  function clashBase(): FakeStore {
    return createFakeStore(
      baseData([
        makeEntry("e-a", "teach-CS-Y2-CS202", "venue-CR1", "WED", "09:00", "10:00"),
        makeEntry("e-b", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00"),
      ]),
    );
  }

  async function revalidate(fake: FakeStore): Promise<Violation[]> {
    const loadResult = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);
    if (!loadResult.ok) {
      throw new Error(`re-validation failed: ${loadResult.kind}`);
    }
    if (loadResult.validation.status !== "ok") {
      throw new Error(
        `expected status "ok", got "${loadResult.validation.status}"`,
      );
    }
    return loadResult.validation.violations;
  }

  it("is conflict-free before the add", async () => {
    const fake = clashBase();
    expect(await revalidate(fake)).toEqual([]);
  });

  it("adds into a venue clash, succeeds, and validation detects VENUE_OVERLAP", async () => {
    const fake = clashBase();
    // teach-SE-Y4-SOEN413 is lecturer-A / group-SE-Y4, so only the venue
    // clashes with entry A at WED 09:00-10:00 @ CR1.
    const result = expectAdded(
      await performDraftAdd(
        fake.store,
        officer,
        addRequest({ teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00" }),
      ),
    );
    // The add itself is a plain success — it never claims conflict-freeness.
    expect(result.entryId).toBe("added-1");

    const violations = await revalidate(fake);
    const types = violationTypes(violations);
    expect(types).toContain("VENUE_OVERLAP");
    const venueOverlap = violations.find((v) => v.type === "VENUE_OVERLAP");
    expect(venueOverlap?.message).toBe("CR1 is used by two classes at the same time (WED 09:00-10:00).");
    // Different lecturers and groups → no lecturer/group overlap.
    expect(types).not.toContain("LECTURER_OVERLAP");
    expect(types).not.toContain("GROUP_OVERLAP");
  });

  it("adds a second session of the same teaching and validation detects LECTURER_OVERLAP and GROUP_OVERLAP", async () => {
    const fake = clashBase();
    // Same teaching as entry A (lecturer-C, group-CS-Y2) at the same time but
    // a different venue → the lecturer and the group clash, the venue does not.
    const result = expectAdded(
      await performDraftAdd(
        fake.store,
        officer,
        addRequest({ teachingId: "teach-CS-Y2-CS202", venueId: "venue-CR2", day: "WED", start: "09:00", end: "10:00" }),
      ),
    );
    expect(result.entryId).toBe("added-1");

    const violations = await revalidate(fake);
    const types = violationTypes(violations);
    expect(types).toContain("LECTURER_OVERLAP");
    expect(types).toContain("GROUP_OVERLAP");
    expect(types).not.toContain("VENUE_OVERLAP");
  });
});

// ---------------------------------------------------------------------------
// Real Prisma transaction against an isolated test database
//
// Exercises the actual createEntry transaction (version DRAFT re-check +
// entry insert + audit insert) against a fresh SQLite database in the OS temp
// directory. The schema is pushed, minimal data is seeded, and the database
// is deleted afterwards. The user's prisma/dev.db is untouched.
// ---------------------------------------------------------------------------

describe("performDraftAdd real Prisma transaction", () => {
  let dbClient: PrismaClient;
  let dbStore: DraftAddStore;
  let dbEntryId: string;
  let dbVersionId: string;
  let dbTeachingId: string;
  let dbVenue1Id: string;
  let dbVenue2Id: string;
  let tempDbPath: string;

  beforeAll(async () => {
    // Create an isolated SQLite database in the OS temp directory.
    tempDbPath = path.join(os.tmpdir(), `tams-add-test-${Date.now()}.db`);
    const tempDbUrl = `file:${tempDbPath.replace(/\\/g, "/")}`;

    // Push the Prisma schema to the temp database (creates all tables).
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      env: { ...process.env, DATABASE_URL: tempDbUrl },
      stdio: "pipe",
      timeout: 30000,
    });

    dbClient = new PrismaClient({ datasources: { db: { url: tempDbUrl } } });

    // Seed minimal referentially-complete data.
    await dbClient.department.create({
      data: { id: "dept-test", name: "Test Dept", schoolId: "school-test" },
    });
    await dbClient.user.create({
      data: { id: OFFICER_ID, name: "Officer", email: "officer@add.test", passwordHash: "x", role: "OFFICER" },
    });
    await dbClient.user.create({
      data: { id: "user-lect", name: "Lecturer", email: "lect@add.test", passwordHash: "x", role: "LECTURER" },
    });
    await dbClient.lecturer.create({
      data: { id: "lect-test", userId: "user-lect", departmentId: "dept-test" },
    });
    await dbClient.unit.create({
      data: { id: "unit-test", code: "TEST101", title: "Test", departmentId: "dept-test", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
    });
    await dbClient.studentGroup.create({
      data: { id: "grp-test", name: "Test Group", size: 30, departmentId: "dept-test" },
    });
    await dbClient.teaching.create({
      data: { id: "teach-test", unitId: "unit-test", lecturerId: "lect-test", groupId: "grp-test", expectedSize: 30, sessionsPerWeek: 3, sessionLength: 1 },
    });
    await dbClient.venue.create({
      data: { id: "venue-test-1", code: "T1", type: "ROOM", capacity: 50, ownerDepartmentId: "dept-test", facilities: "[]", status: "ACTIVE" },
    });
    await dbClient.venue.create({
      data: { id: "venue-test-2", code: "T2", type: "ROOM", capacity: 50, ownerDepartmentId: "dept-test", facilities: "[]", status: "ACTIVE" },
    });
    await dbClient.timetableVersion.create({
      data: { id: "ver-test", semester: 1, status: "DRAFT", createdBy: OFFICER_ID },
    });
    await dbClient.timetableEntry.create({
      data: { id: "entry-test", versionId: "ver-test", teachingId: "teach-test", venueId: "venue-test-1", day: "MON", start: "08:00", end: "09:00", locked: false },
    });

    dbStore = createDraftAddStore(dbClient);
    dbEntryId = "entry-test";
    dbVersionId = "ver-test";
    dbTeachingId = "teach-test";
    dbVenue1Id = "venue-test-1";
    dbVenue2Id = "venue-test-2";
  }, 60000);

  afterAll(async () => {
    if (dbClient !== undefined) {
      await dbClient.$disconnect();
    }
    if (tempDbPath !== undefined && fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  beforeEach(async () => {
    // Reset to the original single-entry DRAFT state before each test.
    await dbClient.timetableVersion.update({
      where: { id: dbVersionId },
      data: { status: "DRAFT" },
    });
    await dbClient.timetableEntry.deleteMany({ where: { id: { not: dbEntryId } } });
    await dbClient.timetableEntry.update({
      where: { id: dbEntryId },
      data: { day: "MON", start: "08:00", end: "09:00", venueId: dbVenue1Id, locked: false },
    });
    await dbClient.auditLog.deleteMany({});
  });

  function dbAddRequest(overrides: Partial<DraftAddRequest> = {}): DraftAddRequest {
    return {
      versionId: dbVersionId,
      teachingId: dbTeachingId,
      venueId: dbVenue2Id,
      day: "TUE",
      start: "10:00",
      end: "11:00",
      ...overrides,
    };
  }

  it("inserts a real row with a generated id, locked:false, and its audit row", async () => {
    const result = expectAdded(await performDraftAdd(dbStore, officer, dbAddRequest()));

    expect(result.versionId).toBe(dbVersionId);

    const entry = await dbClient.timetableEntry.findUnique({ where: { id: result.entryId } });
    expect(entry).not.toBeNull();
    expect(entry?.versionId).toBe(dbVersionId);
    expect(entry?.teachingId).toBe(dbTeachingId);
    expect(entry?.venueId).toBe(dbVenue2Id);
    expect(entry?.day).toBe("TUE");
    expect(entry?.start).toBe("10:00");
    expect(entry?.end).toBe("11:00");
    expect(entry?.locked).toBe(false);

    // The pre-existing entry is preserved untouched.
    const original = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(original?.day).toBe("MON");
    expect(original?.venueId).toBe(dbVenue1Id);

    const audit = await dbClient.auditLog.findFirst({
      where: { entityId: result.entryId, action: "TIMETABLE_ENTRY_ADD" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(OFFICER_ID);
    expect(audit?.entity).toBe("TimetableEntry");
    expect(audit?.reason).toContain("TUE 10:00-11:00");
    expect(audit?.reason).toContain(`@ ${dbVenue2Id}`);
  });

  it("gives repeated adds distinct ids and preserves every earlier row", async () => {
    const first = expectAdded(await performDraftAdd(dbStore, officer, dbAddRequest()));
    const second = expectAdded(
      await performDraftAdd(dbStore, officer, dbAddRequest({ day: "WED", start: "14:00", end: "15:00" })),
    );

    expect(first.entryId).not.toBe(second.entryId);

    const rows = await dbClient.timetableEntry.findMany({ where: { versionId: dbVersionId } });
    expect(rows).toHaveLength(3); // original + two added
    const auditCount = await dbClient.auditLog.count({ where: { action: "TIMETABLE_ENTRY_ADD" } });
    expect(auditCount).toBe(2);
  });

  it("refuses PUBLISHED and ARCHIVED versions without inserting anything", async () => {
    for (const status of ["PUBLISHED", "ARCHIVED"] as const) {
      await dbClient.timetableVersion.update({ where: { id: dbVersionId }, data: { status } });

      const result = await performDraftAdd(dbStore, officer, dbAddRequest());
      expect(result).toEqual({
        ok: false,
        kind: "NOT_DRAFT",
        versionId: dbVersionId,
        storedStatus: status,
      });

      const count = await dbClient.timetableEntry.count({ where: { versionId: dbVersionId } });
      expect(count).toBe(1); // only the original
      expect(await dbClient.auditLog.count()).toBe(0);
    }
  });

  it("refuses a missing version without inserting anything", async () => {
    const result = await performDraftAdd(dbStore, officer, dbAddRequest({ versionId: "ver-ghost" }));
    expect(result).toEqual({ ok: false, kind: "VERSION_NOT_FOUND" });
    expect(await dbClient.timetableEntry.count()).toBe(1);
    expect(await dbClient.auditLog.count()).toBe(0);
  });

  it("fails as STALE inside the transaction when the version is published after the pre-check", async () => {
    // Adapter-level race simulation: the version flips to PUBLISHED between
    // the service's pre-check and the transaction's re-check. Calling
    // createEntry directly with the version already PUBLISHED exercises the
    // same re-check the transaction performs under a real race.
    await dbClient.timetableVersion.update({ where: { id: dbVersionId }, data: { status: "PUBLISHED" } });
    const audit: AddAuditDraft = {
      actorId: OFFICER_ID,
      action: "TIMETABLE_ENTRY_ADD",
      reason: "transaction re-check test",
    };

    const result = await dbStore.createEntry(
      {
        versionId: dbVersionId,
        teachingId: dbTeachingId,
        venueId: dbVenue2Id,
        day: "TUE",
        start: "10:00",
        end: "11:00",
      },
      audit,
    );
    expect(result).toEqual({ stale: true });

    // Nothing inserted, no audit, original row untouched.
    expect(await dbClient.timetableEntry.count()).toBe(1);
    expect(await dbClient.auditLog.count()).toBe(0);
  });

  it("fails as STALE inside the transaction when the version was removed", async () => {
    // A separate, entry-less version that is deleted between pre-check and
    // transaction — the re-check must find no version and insert nothing.
    await dbClient.timetableVersion.create({
      data: { id: "ver-gone", semester: 1, status: "DRAFT", createdBy: OFFICER_ID },
    });
    await dbClient.timetableVersion.delete({ where: { id: "ver-gone" } });

    const result = await dbStore.createEntry(
      {
        versionId: "ver-gone",
        teachingId: dbTeachingId,
        venueId: dbVenue2Id,
        day: "TUE",
        start: "10:00",
        end: "11:00",
      },
      { actorId: OFFICER_ID, action: "TIMETABLE_ENTRY_ADD", reason: "removed-version test" },
    );
    expect(result).toEqual({ stale: true });
    expect(await dbClient.timetableEntry.count()).toBe(1);
    expect(await dbClient.auditLog.count()).toBe(0);
  });

  it("rolls the transaction back when the teaching no longer exists at insert time", async () => {
    // The FK/relation check inside the transaction rejects a teaching removed
    // after the service pre-check; nothing may be persisted.
    const fields: AddFields = {
      versionId: dbVersionId,
      teachingId: "teach-deleted",
      venueId: dbVenue2Id,
      day: "TUE",
      start: "10:00",
      end: "11:00",
    };
    await expect(
      dbStore.createEntry(fields, {
        actorId: OFFICER_ID,
        action: "TIMETABLE_ENTRY_ADD",
        reason: "missing-teaching rollback test",
      }),
    ).rejects.toThrow();

    expect(await dbClient.timetableEntry.count()).toBe(1); // only the original
    expect(await dbClient.auditLog.count()).toBe(0);
  });

  it("converts an adapter failure into INTERNAL_ERROR through the service", async () => {
    // A teaching that passes the service pre-check but cannot be inserted is
    // covered above at adapter level; here the orchestration must surface a
    // typed INTERNAL_ERROR rather than throwing at the caller.
    const failingStore: DraftAddStore = {
      findVersion: (versionId) => dbStore.findVersion(versionId),
      findTeachingById: (teachingId) => dbStore.findTeachingById(teachingId),
      findVenueById: (venueId) => dbStore.findVenueById(venueId),
      createEntry: () => Promise.reject(new Error("simulated insert failure")),
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await performDraftAdd(failingStore, officer, dbAddRequest());
    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(await dbClient.timetableEntry.count()).toBe(1);
    expect(await dbClient.auditLog.count()).toBe(0);
    vi.restoreAllMocks();
  });
});
