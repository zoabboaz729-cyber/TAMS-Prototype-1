/**
 * M3-T2b1 — server-side move operation for an existing DRAFT timetable entry.
 *
 * The store is the injected interface, so every case runs against
 * database-shaped rows built from the real seed data (no live SQLite). The
 * fake implements BOTH DraftMoveStore and DraftValidationStore so the clash
 * test can re-run the existing M3-T2a loader after a move and confirm the
 * violation surfaces. Call counters prove which reads an unauthorised or
 * invalid request triggers, and the audit list proves what was written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedLecturerAvailabilities,
  seedTeachings,
  seedUnits,
  seedVenueUnavailabilities,
  seedVenues,
} from "@/domain/seedData";
import { DEFAULT_POLICY } from "@/domain/policy";
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
import { performDraftMove } from "@/server/draftMove";
import type { DraftMoveResult, DraftMoveStore, MoveAuditDraft } from "@/server/draftMove";

// ---------------------------------------------------------------------------
// Seed rows reshaped as the store returns (mirrors draftValidation.test.ts)
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

function moveRequest(
  entryId: string,
  overrides: Partial<{
    versionId: string;
    day: string;
    start: string;
    end: string;
    venueId: string;
  }> = {},
) {
  return {
    versionId: TEST_VERSION_ID,
    entryId,
    day: "TUE",
    start: "10:00",
    end: "11:00",
    venueId: "venue-CR2",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake store: implements DraftMoveStore & DraftValidationStore
// ---------------------------------------------------------------------------

type FakeData = {
  versions: DraftVersionRow[];
  entries: DraftEntryRow[];
  teachings: TeachingRow[];
  venues: VenueRow[];
  lecturerUnavailable: LecturerUnavailableRow[];
  venueUnavailable: VenueUnavailableRow[];
  audit: MoveAuditDraft[];
};

const STORE_METHODS = [
  "findVersion",
  "findEntry",
  "findVenueById",
  "moveEntry",
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
  store: DraftMoveStore & DraftValidationStore;
  calls: Record<StoreMethod, number>;
  data: FakeData;
  totalCalls: number;
};

function createFakeStore(
  data: FakeData,
  options: { staleOnMove?: boolean; failOn?: StoreMethod } = {},
): FakeStore {
  const calls = Object.fromEntries(STORE_METHODS.map((name) => [name, 0])) as Record<
    StoreMethod,
    number
  >;

  function record<T>(name: StoreMethod, value: T): T {
    calls[name] += 1;
    if (options.failOn === name) {
      throw new Error(`simulated database failure in ${name}`);
    }
    return value;
  }

  const store: DraftMoveStore & DraftValidationStore = {
    // --- shared / move store ---
    findVersion(versionId) {
      return Promise.resolve(
        record(
          "findVersion",
          data.versions.find((version) => version.id === versionId) ?? null,
        ),
      );
    },
    findEntry(entryId) {
      return Promise.resolve(
        record("findEntry", data.entries.find((entry) => entry.id === entryId) ?? null),
      );
    },
    findVenueById(venueId) {
      const venue = data.venues.find((candidate) => candidate.id === venueId) ?? null;
      return Promise.resolve(record("findVenueById", venue === null ? null : { id: venue.id }));
    },
    moveEntry(entryId, expectedVersionId, fields, audit) {
      if (options.staleOnMove === true) {
        // Simulates the version being published or entry locked between the
        // pre-checks and the write — the compare-and-set must fail.
        return Promise.resolve(record("moveEntry", { stale: true } as const));
      }
      // Real in-memory compare-and-set: re-verify version is DRAFT and entry
      // belongs to this version and is unlocked.
      const version = data.versions.find((candidate) => candidate.id === expectedVersionId);
      if (version === undefined || version.status !== "DRAFT") {
        return Promise.resolve(record("moveEntry", { stale: true } as const));
      }
      const entry = data.entries.find(
        (candidate) =>
          candidate.id === entryId &&
          candidate.versionId === expectedVersionId &&
          !candidate.locked,
      );
      if (entry === undefined) {
        return Promise.resolve(record("moveEntry", { stale: true } as const));
      }
      // Persist only the permitted fields.
      entry.day = fields.day;
      entry.start = fields.start;
      entry.end = fields.end;
      entry.venueId = fields.venueId;
      data.audit.push(audit);
      return Promise.resolve(record("moveEntry", { ok: true } as const));
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

function expectMoved(result: DraftMoveResult): Extract<DraftMoveResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a successful move, got ${result.kind}`);
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

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("performDraftMove authorization", () => {
  let fake: FakeStore;

  beforeEach(() => {
    fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
  });

  it("lets an authorised officer move a draft entry", async () => {
    const result = expectMoved(await performDraftMove(fake.store, officer, moveRequest("e1")));

    expect(result).toEqual({ ok: true, entryId: "e1", versionId: TEST_VERSION_ID });
    expect(fake.calls.moveEntry).toBe(1);
  });

  it("rejects a missing session before reading anything", async () => {
    const result = await performDraftMove(fake.store, null, moveRequest("e1"));

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(fake.totalCalls).toBe(0);
  });

  for (const role of forbiddenRoles) {
    it(`denies ${role} and performs no restricted read`, async () => {
      const result = await performDraftMove(fake.store, actorFor(role), moveRequest("e1"));

      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expect(fake.totalCalls).toBe(0);
      expect(Object.keys(result).sort()).toEqual(["kind", "ok"]);
    });
  }

  it("denies a role cast in at runtime that the matrix does not know", async () => {
    const impostor: Actor = { ...officer, role: "SUPERUSER" as UserRole };
    const result = await performDraftMove(fake.store, impostor, moveRequest("e1"));

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(fake.totalCalls).toBe(0);
  });

  it("returns no entry data to a denied caller even when the entry exists", async () => {
    const result = await performDraftMove(fake.store, actorFor("STUDENT"), moveRequest("e1"));

    expect("entryId" in result).toBe(false);
    expect("versionId" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input validation (no store call before this passes)
// ---------------------------------------------------------------------------

describe("performDraftMove input validation", () => {
  let fake: FakeStore;

  beforeEach(() => {
    fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
  });

  it("rejects a malformed start time", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { start: "9:00", end: "10:00" }),
    );

    expect(result).toEqual({ ok: false, kind: "INVALID_INPUT", message: "Time must be in HH:MM format (00:00-23:59)." });
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects a malformed end time (out of range hour)", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { start: "10:00", end: "25:00" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects start not before end", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { start: "11:00", end: "10:00" }),
    );

    expect(result).toEqual({ ok: false, kind: "INVALID_INPUT", message: "Start time must be before end time." });
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects equal start and end (zero-length slot)", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { start: "10:00", end: "10:00" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects an invalid day", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { day: "SAT" } as unknown as ReturnType<typeof moveRequest>),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects an empty version id", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { versionId: "  " }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects an empty venue id", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { venueId: "" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Record resolution
// ---------------------------------------------------------------------------

describe("performDraftMove record resolution", () => {
  it("reports a missing version", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { versionId: "ver-nope" }),
    );

    expect(result).toEqual({ ok: false, kind: "VERSION_NOT_FOUND" });
    expect(fake.calls.findEntry).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("refuses a PUBLISHED version with its stored status", async () => {
    const fake = createFakeStore({
      ...baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      versions: [makeVersion("PUBLISHED")],
    });
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus: "PUBLISHED",
    });
    expect(fake.calls.findEntry).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("refuses an ARCHIVED version too", async () => {
    const fake = createFakeStore({
      ...baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      versions: [makeVersion("ARCHIVED")],
    });
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("NOT_DRAFT");
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("reports a missing entry", async () => {
    const fake = createFakeStore(baseData([]));
    const result = await performDraftMove(fake.store, officer, moveRequest("e-missing"));

    expect(result).toEqual({ ok: false, kind: "ENTRY_NOT_FOUND" });
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("reports an entry that belongs to a different version (cross-version id)", async () => {
    const other = makeEntry("e-other", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00", {
      versionId: "ver-other",
    });
    const fake = createFakeStore({ ...baseData([other]), versions: [makeVersion("DRAFT"), makeVersion("DRAFT")] });
    const result = await performDraftMove(fake.store, officer, moveRequest("e-other"));

    expect(result).toEqual({ ok: false, kind: "ENTRY_WRONG_VERSION" });
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("refuses a locked entry", async () => {
    const locked = makeEntry("e-locked", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00", {
      locked: true,
    });
    const fake = createFakeStore(baseData([locked]));
    const result = await performDraftMove(fake.store, officer, moveRequest("e-locked"));

    expect(result).toEqual({ ok: false, kind: "ENTRY_LOCKED" });
    expect(fake.calls.findVenueById).toBe(0);
    expect(fake.calls.moveEntry).toBe(0);
  });

  it("reports a missing venue", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { venueId: "venue-gone" }),
    );

    expect(result).toEqual({ ok: false, kind: "VENUE_NOT_FOUND" });
    expect(fake.calls.moveEntry).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stale / concurrent updates
// ---------------------------------------------------------------------------

describe("performDraftMove stale concurrent updates", () => {
  it("returns STALE and does not modify the entry when the compare-and-set fails", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      { staleOnMove: true },
    );
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result).toEqual({ ok: false, kind: "STALE" });
    expect(fake.calls.moveEntry).toBe(1);
    // Entry unchanged, no audit written.
    const entry = findEntry(fake.data, "e1");
    expect(entry).toEqual(makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00"));
    expect(fake.data.audit).toEqual([]);
  });

  it("returns STALE when the version was published between the pre-check and the write", async () => {
    // findVersion returns DRAFT, but moveEntry's compare-and-set re-reads and
    // finds the version no longer DRAFT (simulated via staleOnMove).
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      { staleOnMove: true },
    );
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("STALE");
    expect(fake.data.audit).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Successful move
// ---------------------------------------------------------------------------

describe("performDraftMove success", () => {
  it("persists only the permitted fields and writes an audit row", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    const result = expectMoved(
      await performDraftMove(fake.store, officer, moveRequest("e1", { day: "WED", start: "09:00", end: "10:00", venueId: "venue-CR2" })),
    );

    expect(result).toEqual({ ok: true, entryId: "e1", versionId: TEST_VERSION_ID });

    const entry = findEntry(fake.data, "e1");
    // Permitted fields changed.
    expect(entry.day).toBe("WED");
    expect(entry.start).toBe("09:00");
    expect(entry.end).toBe("10:00");
    expect(entry.venueId).toBe("venue-CR2");
    // Protected fields unchanged: teaching assignment, version, lock state.
    expect(entry.teachingId).toBe("teach-SE-Y4-SOEN413");
    expect(entry.versionId).toBe(TEST_VERSION_ID);
    expect(entry.locked).toBe(false);

    // One audit row with the actor, action, and a reason naming the move.
    expect(fake.data.audit).toHaveLength(1);
    expect(fake.data.audit[0].actorId).toBe(OFFICER_ID);
    expect(fake.data.audit[0].action).toBe("TIMETABLE_ENTRY_MOVE");
    expect(fake.data.audit[0].reason).toContain("MON 08:00-09:00");
    expect(fake.data.audit[0].reason).toContain("WED 09:00-10:00");
  });

  it("does not touch other entries in the same draft", async () => {
    const fake = createFakeStore(
      baseData([
        makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00"),
        makeEntry("e2", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00"),
      ]),
    );
    await performDraftMove(fake.store, officer, moveRequest("e1", { day: "WED", start: "09:00", end: "10:00", venueId: "venue-GR1" }));

    const other = findEntry(fake.data, "e2");
    expect(other).toEqual(makeEntry("e2", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00"));
    expect(fake.data.audit).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Move into a deliberate clash + subsequent validation (requirement #9)
// ---------------------------------------------------------------------------

describe("performDraftMove into a clash", () => {
  /**
   * Entry A: teach-CS-Y2-CS202 (lecturer-C, group-CS-Y2), CR1, WED 09:00-10:00.
   * Entry B: teach-SE-Y4-SOEN415 (lecturer-B, group-SE-Y4), CR2, THU 10:00-11:00.
   * Neither conflicts before the move. Moving B to WED 09:00-10:00 @ CR1 lands
   * it in a venue overlap with A — different lecturers and groups, so only
   * VENUE_OVERLAP should be reported.
   */
  const clashEntries: DraftEntryRow[] = [
    makeEntry("e-a", "teach-CS-Y2-CS202", "venue-CR1", "WED", "09:00", "10:00"),
    makeEntry("e-b", "teach-SE-Y4-SOEN415", "venue-CR2", "THU", "10:00", "11:00"),
  ];

  it("is conflict-free before the move", async () => {
    const fake = createFakeStore(baseData(clashEntries));
    const loadResult = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);
    if (!loadResult.ok) {
      throw new Error(`load failed before the move: ${loadResult.kind}`);
    }
    if (loadResult.validation.status !== "ok") {
      throw new Error(`expected status "ok" before the move, got "${loadResult.validation.status}"`);
    }
    expect(loadResult.validation.violations).toEqual([]);
  });

  it("moves into the clash successfully and does not report itself conflict-free", async () => {
    const fake = createFakeStore(baseData(clashEntries));
    const result = expectMoved(
      await performDraftMove(fake.store, officer, moveRequest("e-b", { day: "WED", start: "09:00", end: "10:00", venueId: "venue-CR1" })),
    );
    expect(result.entryId).toBe("e-b");

    // Subsequent validation reports the VENUE_OVERLAP (requirement #9).
    const loadResult = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);
    if (!loadResult.ok) {
      throw new Error(`re-validation failed: ${loadResult.kind}`);
    }
    expect(loadResult.validation.status).toBe("ok");
    const types = violationTypes(loadResult.validation.violations);
    expect(types).toContain("VENUE_OVERLAP");
    const venueOverlap = loadResult.validation.violations.find((v) => v.type === "VENUE_OVERLAP");
    expect(venueOverlap?.message).toBe("CR1 is used by two classes at the same time (WED 09:00-10:00).");
    // Different lecturers and groups → no lecturer/group overlap from the move.
    expect(types).not.toContain("LECTURER_OVERLAP");
    expect(types).not.toContain("GROUP_OVERLAP");
  });
});

// ---------------------------------------------------------------------------
// Store failures
// ---------------------------------------------------------------------------

describe("performDraftMove store failures", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("turns a findVersion failure into INTERNAL_ERROR, never a clean result", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      { failOn: "findVersion" },
    );
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });

  it("turns a moveEntry failure into INTERNAL_ERROR", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      { failOn: "moveEntry" },
    );
    const result = await performDraftMove(fake.store, officer, moveRequest("e1"));

    expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
  });
});
