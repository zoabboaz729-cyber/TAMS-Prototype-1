/**
 * M3-T2b1 / M3-T2b1a — server-side move of an existing DRAFT timetable entry
 * with optimistic-concurrency protection against stale draft moves.
 *
 * Two suites. (1) Fake-store suite: the store is the injected interface, so
 * every case runs against database-shaped rows built from the real seed data.
 * The fake implements BOTH DraftMoveStore and DraftValidationStore, applies
 * the same compare-and-set rules as the Prisma adapter (version DRAFT, entry
 * unlocked, expected previous schedule still matching) and counts calls, so an
 * unauthorised or invalid request is proven to trigger zero reads and a stale
 * move is proven to persist nothing. (2) Isolated-database suite: a temporary
 * SQLite file (never prisma/dev.db) with the real schema, running the real
 * Prisma adapter and its transaction against real stored rows.
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
import type { DraftMoveRequest, DraftMoveResult, DraftMoveStore, MoveAuditDraft } from "@/server/draftMove";
import { createDraftMoveStore } from "@/server/draftStorePrisma";

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
  overrides: Partial<DraftMoveRequest> = {},
): DraftMoveRequest {
  return {
    versionId: TEST_VERSION_ID,
    entryId,
    // Proposed new schedule.
    day: "TUE",
    start: "10:00",
    end: "11:00",
    venueId: "venue-CR2",
    // Expected previous schedule — matches the standard test entry
    // makeEntry("e1", ..., "venue-CR1", "MON", "08:00", "09:00").
    expectedDay: "MON",
    expectedStart: "08:00",
    expectedEnd: "09:00",
    expectedVenueId: "venue-CR1",
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
      // belongs to this version, is unlocked, and its schedule matches the
      // expected previous values (optimistic concurrency).
      const version = data.versions.find((candidate) => candidate.id === expectedVersionId);
      if (version === undefined || version.status !== "DRAFT") {
        return Promise.resolve(record("moveEntry", { stale: true } as const));
      }
      const entry = data.entries.find(
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

  it("rejects a malformed expected start time", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { expectedStart: "8:00", expectedEnd: "09:00" }),
    );

    expect(result).toEqual({ ok: false, kind: "INVALID_INPUT", message: "Time must be in HH:MM format (00:00-23:59)." });
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects an invalid expected day", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { expectedDay: "SUN" } as unknown as DraftMoveRequest),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("INVALID_INPUT");
    expect(fake.totalCalls).toBe(0);
  });

  it("rejects an empty expected venue id", async () => {
    const result = await performDraftMove(
      fake.store,
      officer,
      moveRequest("e1", { expectedVenueId: "" }),
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
// Optimistic concurrency (expected previous schedule)
// ---------------------------------------------------------------------------

describe("performDraftMove optimistic concurrency", () => {
  it("succeeds when the expected state matches the stored state", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    const result = expectMoved(await performDraftMove(fake.store, officer, moveRequest("e1")));

    expect(result).toEqual({ ok: true, entryId: "e1", versionId: TEST_VERSION_ID });
    expect(fake.data.audit).toHaveLength(1);
  });

  for (const [label, override] of [
    ["expectedDay differs", { expectedDay: "TUE" }],
    ["expectedStart differs", { expectedStart: "09:00" }],
    ["expectedEnd differs", { expectedEnd: "10:00" }],
    ["expectedVenueId differs", { expectedVenueId: "venue-CR2" }],
  ] as const) {
    it(`returns STALE and does not modify the entry when ${label}`, async () => {
      const fake = createFakeStore(
        baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
      );
      const result = await performDraftMove(
        fake.store,
        officer,
        moveRequest("e1", override as Partial<DraftMoveRequest>),
      );

      expect(result).toEqual({ ok: false, kind: "STALE" });
      // The pre-check catches this before moveEntry, so moveEntry is not called.
      expect(fake.calls.moveEntry).toBe(0);
      // Entry unchanged, no audit.
      const entry = findEntry(fake.data, "e1");
      expect(entry).toEqual(makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00"));
      expect(fake.data.audit).toEqual([]);
    });
  }

  it("rejects a second move based on the same original state after the first succeeds", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    // First move with correct expected values — succeeds.
    const first = expectMoved(await performDraftMove(fake.store, officer, moveRequest("e1")));

    expect(first.ok).toBe(true);

    // Second move based on the same original expected values — the entry now
    // reflects the first move, so the expected previous schedule no longer
    // matches. STALE, not an overwrite.
    const second = await performDraftMove(fake.store, officer, moveRequest("e1", { day: "WED", start: "09:00", end: "10:00", venueId: "venue-GR1" }));

    expect(second).toEqual({ ok: false, kind: "STALE" });

    // Entry keeps the first move's values.
    const entry = findEntry(fake.data, "e1");
    expect(entry.day).toBe("TUE");
    expect(entry.start).toBe("10:00");
    expect(entry.end).toBe("11:00");
    expect(entry.venueId).toBe("venue-CR2");
    // Only the first move's audit record exists.
    expect(fake.data.audit).toHaveLength(1);
  });

  it("writes an audit record that names the accepted transition accurately", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "08:00", "09:00")]),
    );
    await performDraftMove(fake.store, officer, moveRequest("e1", { day: "WED", start: "14:00", end: "15:00", venueId: "venue-GR1" }));

    expect(fake.data.audit).toHaveLength(1);
    expect(fake.data.audit[0].reason).toBe(
      "Moved from MON 08:00-09:00 @ venue-CR1 to WED 14:00-15:00 @ venue-GR1.",
    );
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
      await performDraftMove(fake.store, officer, moveRequest("e-b", { day: "WED", start: "09:00", end: "10:00", venueId: "venue-CR1", expectedDay: "THU", expectedStart: "10:00", expectedEnd: "11:00", expectedVenueId: "venue-CR2" })),
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

// ---------------------------------------------------------------------------
// Real Prisma transaction against an isolated test database
//
// Exercises the actual compare-and-set (updateMany WHERE clause) and audit
// write inside a real Prisma $transaction. A fresh SQLite database is created
// in the OS temp directory, the schema is pushed, minimal data is seeded, and
// the database is deleted afterwards. The user's prisma/dev.db is untouched.
// ---------------------------------------------------------------------------

describe("performDraftMove real Prisma transaction", () => {
  let dbClient: PrismaClient;
  let dbStore: DraftMoveStore;
  let dbEntryId: string;
  let dbVersionId: string;
  let dbVenue1Id: string;
  let dbVenue2Id: string;
  let tempDbPath: string;

  beforeAll(async () => {
    // Create an isolated SQLite database in the OS temp directory.
    tempDbPath = path.join(os.tmpdir(), `tams-move-test-${Date.now()}.db`);
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
      data: { id: OFFICER_ID, name: "Officer", email: "officer@move.test", passwordHash: "x", role: "OFFICER" },
    });
    await dbClient.user.create({
      data: { id: "user-lect", name: "Lecturer", email: "lect@move.test", passwordHash: "x", role: "LECTURER" },
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

    dbStore = createDraftMoveStore(dbClient);
    dbEntryId = "entry-test";
    dbVersionId = "ver-test";
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
    // Reset the version and the entry to their original state before each test.
    await dbClient.timetableVersion.update({
      where: { id: dbVersionId },
      data: { status: "DRAFT" },
    });
    await dbClient.timetableEntry.update({
      where: { id: dbEntryId },
      data: { day: "MON", start: "08:00", end: "09:00", venueId: dbVenue1Id, locked: false },
    });
    await dbClient.auditLog.deleteMany({ where: { entityId: dbEntryId } });
  });

  it("moves an entry when the expected state matches the stored state", async () => {
    const result = await performDraftMove(dbStore, officer, {
      versionId: dbVersionId,
      entryId: dbEntryId,
      day: "TUE",
      start: "10:00",
      end: "11:00",
      venueId: dbVenue2Id,
      expectedDay: "MON",
      expectedStart: "08:00",
      expectedEnd: "09:00",
      expectedVenueId: dbVenue1Id,
    });

    expect(result).toEqual({ ok: true, entryId: dbEntryId, versionId: dbVersionId });

    const entry = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(entry?.day).toBe("TUE");
    expect(entry?.start).toBe("10:00");
    expect(entry?.end).toBe("11:00");
    expect(entry?.venueId).toBe(dbVenue2Id);

    const audit = await dbClient.auditLog.findFirst({
      where: { entityId: dbEntryId, action: "TIMETABLE_ENTRY_MOVE" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(OFFICER_ID);
    expect(audit?.reason).toContain("MON 08:00-09:00");
    expect(audit?.reason).toContain("TUE 10:00-11:00");
  });

  it("returns STALE when the entry changed since the officer loaded it", async () => {
    // Simulate another officer moving the entry first.
    await dbClient.timetableEntry.update({
      where: { id: dbEntryId },
      data: { day: "WED", start: "14:00", end: "15:00", venueId: dbVenue2Id },
    });

    // This officer tries with the old expected values.
    const result = await performDraftMove(dbStore, officer, {
      versionId: dbVersionId,
      entryId: dbEntryId,
      day: "FRI",
      start: "10:00",
      end: "11:00",
      venueId: dbVenue1Id,
      expectedDay: "MON",
      expectedStart: "08:00",
      expectedEnd: "09:00",
      expectedVenueId: dbVenue1Id,
    });

    expect(result).toEqual({ ok: false, kind: "STALE" });

    // Entry keeps the other officer's change.
    const entry = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(entry?.day).toBe("WED");
    expect(entry?.start).toBe("14:00");
    expect(entry?.venueId).toBe(dbVenue2Id);

    // No audit for the rejected move.
    const auditCount = await dbClient.auditLog.count({
      where: { entityId: dbEntryId, action: "TIMETABLE_ENTRY_MOVE" },
    });
    expect(auditCount).toBe(0);
  });

  it("rejects a second move based on the same original state", async () => {
    // First move succeeds.
    const first = await performDraftMove(dbStore, officer, {
      versionId: dbVersionId,
      entryId: dbEntryId,
      day: "TUE",
      start: "10:00",
      end: "11:00",
      venueId: dbVenue2Id,
      expectedDay: "MON",
      expectedStart: "08:00",
      expectedEnd: "09:00",
      expectedVenueId: dbVenue1Id,
    });
    expect(first.ok).toBe(true);

    // Second move with same original expected → STALE.
    const second = await performDraftMove(dbStore, officer, {
      versionId: dbVersionId,
      entryId: dbEntryId,
      day: "WED",
      start: "09:00",
      end: "10:00",
      venueId: dbVenue1Id,
      expectedDay: "MON",
      expectedStart: "08:00",
      expectedEnd: "09:00",
      expectedVenueId: dbVenue1Id,
    });
    expect(second).toEqual({ ok: false, kind: "STALE" });

    // Entry has the first move's values.
    const entry = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(entry?.day).toBe("TUE");
    expect(entry?.start).toBe("10:00");

    // Only one audit record (from the first move).
    const auditCount = await dbClient.auditLog.count({
      where: { entityId: dbEntryId, action: "TIMETABLE_ENTRY_MOVE" },
    });
    expect(auditCount).toBe(1);
  });

  it("persists nothing when the locked entry matches the expected schedule (real compare-and-set)", async () => {
    // The pre-checks would pass (schedule matches), but the transactional
    // updateMany also requires locked=false. Call moveEntry directly to
    // exercise the WHERE clause inside a real Prisma transaction.
    await dbClient.timetableEntry.update({ where: { id: dbEntryId }, data: { locked: true } });
    const outcome = await dbStore.moveEntry(
      dbEntryId,
      dbVersionId,
      {
        day: "TUE",
        start: "10:00",
        end: "11:00",
        venueId: dbVenue2Id,
        expectedDay: "MON",
        expectedStart: "08:00",
        expectedEnd: "09:00",
        expectedVenueId: dbVenue1Id,
      },
      {
        actorId: OFFICER_ID,
        action: "TIMETABLE_ENTRY_MOVE",
        reason: "must never be written for a rejected move",
      },
    );

    expect(outcome).toEqual({ stale: true });
    const entry = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(entry?.day).toBe("MON");
    expect(entry?.venueId).toBe(dbVenue1Id);
    const auditCount = await dbClient.auditLog.count({ where: { entityId: dbEntryId } });
    expect(auditCount).toBe(0);
  });

  it("persists nothing when the version is published before the write commits (real compare-and-set)", async () => {
    // The transaction re-reads the version and rejects a status that is not
    // DRAFT — requirement 5: the transactional DRAFT check is retained.
    await dbClient.timetableVersion.update({ where: { id: dbVersionId }, data: { status: "PUBLISHED" } });
    const outcome = await dbStore.moveEntry(
      dbEntryId,
      dbVersionId,
      {
        day: "TUE",
        start: "10:00",
        end: "11:00",
        venueId: dbVenue2Id,
        expectedDay: "MON",
        expectedStart: "08:00",
        expectedEnd: "09:00",
        expectedVenueId: dbVenue1Id,
      },
      {
        actorId: OFFICER_ID,
        action: "TIMETABLE_ENTRY_MOVE",
        reason: "must never be written for a rejected move",
      },
    );

    expect(outcome).toEqual({ stale: true });
    const entry = await dbClient.timetableEntry.findUnique({ where: { id: dbEntryId } });
    expect(entry?.day).toBe("MON");
    const auditCount = await dbClient.auditLog.count({ where: { entityId: dbEntryId } });
    expect(auditCount).toBe(0);
  });
});
