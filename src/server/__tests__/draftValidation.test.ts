/**
 * M3-T2a — server-side draft validation loader.
 *
 * The store is the injected interface, so every case runs against
 * database-shaped rows built from the real seed data (no live SQLite), and the
 * call counter proves what an unauthorised caller makes the server read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedLecturerAvailabilities,
  seedTeachings,
  seedTimetableEntries,
  seedTimetableVersions,
  seedUnits,
  seedUsers,
  seedVenueUnavailabilities,
  seedVenues,
} from "@/domain/seedData";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { Actor } from "@/domain/permissions";
import type { UserRole } from "@/domain/types";
import type { Violation } from "@/domain/validator";
import {
  loadDraftForValidation,
  type DraftEntryRow,
  type DraftLoadResult,
  type DraftValidationStore,
  type DraftVersionRow,
  type LecturerUnavailableRow,
  type TeachingRow,
  type VenueRow,
  type VenueUnavailableRow,
} from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Seed data, reshaped as the rows the Prisma store returns
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

const seedVersionRows: DraftVersionRow[] = seedTimetableVersions.map((version) => ({
  id: version.id,
  semester: version.semester,
  status: version.status,
}));

const seedEntryRows: DraftEntryRow[] = seedTimetableEntries.map((entry) => ({
  id: entry.id,
  versionId: entry.versionId,
  teachingId: entry.teachingId,
  venueId: entry.venueId,
  day: entry.day,
  start: entry.start,
  end: entry.end,
  locked: entry.locked,
}));

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
  };
}

// ---------------------------------------------------------------------------
// Fake store with a call counter and one injectable failure
// ---------------------------------------------------------------------------

type FakeData = {
  versions: DraftVersionRow[];
  entries: DraftEntryRow[];
  teachings: TeachingRow[];
  venues: VenueRow[];
  lecturerUnavailable: LecturerUnavailableRow[];
  venueUnavailable: VenueUnavailableRow[];
};

type StoreMethod = keyof DraftValidationStore;

const STORE_METHODS: StoreMethod[] = [
  "findVersion",
  "listEntriesByVersion",
  "listTeachingsByIds",
  "listVenuesByIds",
  "listLecturerUnavailableByLecturerIds",
  "listVenueUnavailableByVenueIds",
];

function baseData(entries: DraftEntryRow[]): FakeData {
  return {
    versions: [makeVersion("DRAFT"), ...seedVersionRows],
    entries,
    teachings: seedTeachingRows,
    venues: seedVenueRows,
    lecturerUnavailable: seedLecturerUnavailableRows,
    venueUnavailable: seedVenueUnavailableRows,
  };
}

type FakeStore = {
  store: DraftValidationStore;
  calls: Record<StoreMethod, number>;
  totalCalls: number;
};

function createFakeStore(
  data: FakeData,
  options: { failOn?: StoreMethod; ignoreVersionFilter?: boolean } = {},
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

  const store: DraftValidationStore = {
    findVersion(versionId) {
      return Promise.resolve(
        record(
          "findVersion",
          data.versions.find((version) => version.id === versionId) ?? null,
        ),
      );
    },
    listEntriesByVersion(versionId) {
      // ignoreVersionFilter simulates a broken adapter that returns rows from
      // other versions; the loader must still scope the result.
      const rows =
        options.ignoreVersionFilter === true
          ? data.entries
          : data.entries.filter((entry) => entry.versionId === versionId);
      return Promise.resolve(record("listEntriesByVersion", rows));
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
    get totalCalls() {
      return STORE_METHODS.reduce((total, name) => total + calls[name], 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function actorFor(role: UserRole): Actor {
  const seed = seedUsers.find((user) => user.role === role);
  if (seed === undefined) {
    throw new Error(`no seeded ${role} user`);
  }
  return {
    id: seed.id,
    role: seed.role,
    departmentId: seed.departmentId,
    studentGroupId: seed.studentGroupId,
  };
}

const officer: Actor = {
  id: OFFICER_ID,
  role: "OFFICER",
  departmentId: null,
  studentGroupId: null,
};

/** Every role except the officer; EDIT_DRAFT is officer-only. */
const forbiddenRoles: UserRole[] = [
  "STUDENT",
  "LECTURER",
  "DEPT_REP",
  "APPROVER",
  "ADMIN",
];

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function expectOk(result: DraftLoadResult): Extract<DraftLoadResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a successful draft load, got ${result.kind}`);
  }
  return result;
}

function expectComplete(result: DraftLoadResult): Violation[] {
  const outcome = expectOk(result).validation;
  if (outcome.status !== "ok") {
    throw new Error(`expected status "ok", got "${outcome.status}"`);
  }
  return outcome.violations;
}

function types(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.type);
}

function loadSingle(
  entry: DraftEntryRow,
  options: { failOn?: StoreMethod } = {},
): FakeStore {
  return createFakeStore(baseData([entry]), options);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("loadDraftForValidation authorization", () => {
  let fake: FakeStore;

  beforeEach(() => {
    fake = createFakeStore(baseData(seedEntryRows));
  });

  it("lets an authorised officer load a draft", async () => {
    const result = expectOk(
      await loadDraftForValidation(fake.store, officer, "ver-s1-planted"),
    );

    expect(result.version).toEqual({
      id: "ver-s1-planted",
      semester: 1,
      status: "DRAFT",
    });
    expect(result.entries).toHaveLength(seedEntryRows.length);
  });

  it("rejects a missing session before reading anything", async () => {
    const result = await loadDraftForValidation(fake.store, null, "ver-s1-planted");

    expect(result).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(fake.totalCalls).toBe(0);
  });

  for (const role of forbiddenRoles) {
    it(`denies ${role} and performs no restricted read`, async () => {
      const result = await loadDraftForValidation(
        fake.store,
        actorFor(role),
        "ver-s1-planted",
      );

      expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
      expect(fake.totalCalls).toBe(0);
      expect(Object.keys(result).sort()).toEqual(["kind", "ok"]);
    });
  }

  it("denies a role cast in at runtime that the matrix does not know", async () => {
    const impostor: Actor = { ...officer, role: "SUPERUSER" as UserRole };
    const result = await loadDraftForValidation(
      fake.store,
      impostor,
      "ver-s1-planted",
    );

    expect(result).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(fake.totalCalls).toBe(0);
  });

  it("returns no draft data to a denied caller even when the version exists", async () => {
    const result = await loadDraftForValidation(
      fake.store,
      actorFor("STUDENT"),
      "ver-s1-planted",
    );

    expect("entries" in result).toBe(false);
    expect("validation" in result).toBe(false);
    expect("version" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

describe("loadDraftForValidation version status", () => {
  it("reports an explicit not-found for an unknown version id", async () => {
    const fake = createFakeStore(baseData(seedEntryRows));
    const result = await loadDraftForValidation(fake.store, officer, "ver-nope");

    expect(result).toEqual({ ok: false, kind: "NOT_FOUND" });
    expect(fake.calls.findVersion).toBe(1);
    expect(fake.calls.listEntriesByVersion).toBe(0);
  });

  it("refuses a PUBLISHED version as an editable draft without reading its entries", async () => {
    const fake = createFakeStore({
      ...baseData(seedEntryRows),
      versions: [{ id: TEST_VERSION_ID, semester: 1, status: "PUBLISHED" }],
    });
    const result = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);

    expect(result).toEqual({
      ok: false,
      kind: "NOT_DRAFT",
      versionId: TEST_VERSION_ID,
      storedStatus: "PUBLISHED",
    });
    expect(fake.calls.listEntriesByVersion).toBe(0);
  });

  it("refuses an ARCHIVED version too", async () => {
    const fake = createFakeStore({
      ...baseData(seedEntryRows),
      versions: [{ id: TEST_VERSION_ID, semester: 1, status: "ARCHIVED" }],
    });
    const result = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NOT_DRAFT");
    }
    expect(fake.calls.listEntriesByVersion).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Entry scoping and ordering
// ---------------------------------------------------------------------------

describe("loadDraftForValidation entry scoping", () => {
  it("keeps only the requested version when the adapter returns other rows", async () => {
    const otherVersionEntry: DraftEntryRow = {
      ...makeEntry(
        "entry-other-version",
        "teach-SE-Y4-SOEN413",
        "venue-CR1",
        "MON",
        "09:00",
        "10:00",
      ),
      versionId: "ver-s1-planted",
    };
    const fake = createFakeStore(
      { ...baseData([otherVersionEntry]), versions: [makeVersion("DRAFT")] },
      { ignoreVersionFilter: true },
    );

    const result = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID));

    expect(result.entries).toEqual([]);
    expect(result.validation).toEqual({ status: "ok", violations: [] });
  });

  it("orders entries MON to FRI so the editor index is stable", async () => {
    const fake = createFakeStore(baseData(seedEntryRows));
    const result = expectOk(
      await loadDraftForValidation(fake.store, officer, "ver-s1-planted"),
    );

    expect(result.entries.map((entry) => entry.day)).toEqual([
      "MON",
      "MON",
      "MON",
      "TUE",
      "TUE",
      "TUE",
      "WED",
      "THU",
      "THU",
      "FRI",
    ]);
    expect(result.entries.map((entry) => entry.start)).toEqual([
      "08:00",
      "08:00",
      "14:00",
      "10:00",
      "10:00",
      "14:00",
      "09:00",
      "10:00",
      "14:00",
      "10:00",
    ]);
  });

  it("labels each row with the unit and venue codes resolved from the database", async () => {
    const fake = createFakeStore(baseData(seedEntryRows));
    const result = expectOk(
      await loadDraftForValidation(fake.store, officer, "ver-s1-planted"),
    );
    const first = result.entries[0];

    expect(first).toEqual({
      id: "entry-planted-venue-1",
      teachingId: "teach-SE-Y4-SOEN413",
      venueId: "venue-CR1",
      day: "MON",
      start: "08:00",
      end: "09:00",
      locked: false,
      unitCode: "SOEN 413",
      venueCode: "CR1",
    });
  });
});

// ---------------------------------------------------------------------------
// Validation of database-shaped data
// ---------------------------------------------------------------------------

describe("loadDraftForValidation with seeded data", () => {
  it("detects the two planted conflicts and nothing else", async () => {
    const fake = createFakeStore(baseData(seedEntryRows));
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, "ver-s1-planted"),
    );

    expect(types(violations)).toEqual(["VENUE_OVERLAP", "LECTURER_OVERLAP"]);
    expect(violations[0]).toEqual({
      type: "VENUE_OVERLAP",
      entryId: "entry-planted-venue-1",
      conflictEntryId: "entry-planted-venue-2",
      message: "CR1 is used by two classes at the same time (MON 08:00-09:00).",
    });
    expect(violations[1]).toEqual({
      type: "LECTURER_OVERLAP",
      entryId: "entry-planted-lecturer-1",
      conflictEntryId: "entry-planted-lecturer-2",
      message: "Lecturer teaches two classes at the same time (TUE 10:00-11:00).",
    });
  });

  it("reports a capacity breach using the stored venue capacity and group size", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y1-SE101", "venue-CR2", "MON", "09:00", "10:00")]),
    );
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID),
    );

    expect(types(violations)).toEqual(["CAPACITY"]);
    expect(violations[0].message).toBe(
      "CR2 holds 50 students but DEMO-SE101 expects 60.",
    );
  });

  it("reports a venue type mismatch from the stored unit requirement", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN400", "venue-CR1", "MON", "09:00", "10:00")]),
    );
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID),
    );

    expect(types(violations)).toEqual(["VENUE_TYPE"]);
    expect(violations[0].message).toBe(
      "CR1 is a ROOM but SOEN 400 requires a LAB.",
    );
  });

  it("treats an empty draft as a completed validation, not an incomplete one", async () => {
    const fake = createFakeStore(baseData([]));
    const result = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID));

    expect(result.entries).toEqual([]);
    expect(result.validation).toEqual({ status: "ok", violations: [] });
    expect(fake.calls.listTeachingsByIds).toBe(0);
    expect(fake.calls.listVenuesByIds).toBe(0);
    expect(fake.calls.listLecturerUnavailableByLecturerIds).toBe(0);
    expect(fake.calls.listVenueUnavailableByVenueIds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unavailability records
// ---------------------------------------------------------------------------

describe("loadDraftForValidation unavailable periods", () => {
  it("applies a stored lecturer unavailable period", async () => {
    // lecturer-A is unavailable MON 15:00-17:00 in the seed.
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "15:00", "16:00")]),
    );
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID),
    );

    expect(types(violations)).toEqual(["LECTURER_UNAVAILABLE"]);
    expect(violations[0].message).toBe("Lecturer is unavailable MON 15:00-17:00.");
  });

  it("does not report a lecturer unavailable period belonging to another lecturer", async () => {
    // teach-SE-Y4-SOEN426 is lecturer-D, who has no stored period.
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN426", "venue-CR2", "MON", "15:00", "16:00")]),
    );

    expect(expectComplete(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))).toEqual([]);
  });

  it("applies a stored venue unavailable period", async () => {
    const venuePeriod: VenueUnavailableRow = {
      id: "vu-CR1-test",
      venueId: "venue-CR1",
      day: "FRI",
      start: "14:00",
      end: "16:00",
      reason: "Sample maintenance",
    };
    const fake = createFakeStore({
      ...baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "FRI", "14:30", "15:30")]),
      venueUnavailable: [venuePeriod],
    });
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID),
    );

    expect(types(violations)).toEqual(["VENUE_UNAVAILABLE"]);
    expect(violations[0].message).toBe("CR1 is unavailable FRI 14:00-16:00.");
  });

  it("ignores a stored row that says the lecturer is available", async () => {
    const fake = createFakeStore({
      ...baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "15:00", "16:00")]),
      lecturerUnavailable: [
        {
          id: "la-A-positive",
          lecturerId: "lecturer-A",
          day: "MON",
          start: "15:00",
          end: "16:00",
          available: true,
        },
      ],
    });

    expect(expectComplete(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))).toEqual([]);
  });

  it("drops corrupt unavailable rows instead of matching them", async () => {
    const fake = createFakeStore({
      ...baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "15:00", "16:00")]),
      lecturerUnavailable: [
        { id: "la-bad-day", lecturerId: "lecturer-A", day: "SAT", start: "15:00", end: "16:00", available: false },
        { id: "la-bad-time", lecturerId: "lecturer-A", day: "MON", start: "25:00", end: "26:00", available: false },
        { id: "la-reversed", lecturerId: "lecturer-A", day: "MON", start: "16:00", end: "15:00", available: false },
        { id: "la-zero", lecturerId: "lecturer-A", day: "MON", start: "15:00", end: "15:00", available: false },
      ],
    });

    expect(expectComplete(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Incomplete context
// ---------------------------------------------------------------------------

describe("loadDraftForValidation incomplete context", () => {
  it("reports a missing teaching as incomplete even with zero violations", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-does-not-exist", "venue-CR1", "MON", "09:00", "10:00")]),
    );
    const outcome = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))
      .validation;

    if (outcome.status !== "incomplete") {
      throw new Error(`expected an incomplete outcome, got "${outcome.status}"`);
    }
    expect(outcome.violations).toEqual([]);
    expect(outcome.missingContext).toEqual([
      {
        kind: "MISSING_TEACHING",
        entryIndex: 0,
        entryId: "e1",
        refId: "teach-does-not-exist",
        message:
          'Entry e1 refers to teaching "teach-does-not-exist", which is missing from the validation context.',
      },
    ]);
  });

  it("reports a missing venue and still returns the violations it could detect", async () => {
    // Distinct unresolvable venue ids, so the venue-overlap check (which
    // compares ids, not resolved venues) stays out of the expectation.
    const fake = createFakeStore(
      baseData([
        makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-gone-a", "MON", "09:00", "10:00"),
        makeEntry("e2", "teach-SE-Y4-SOEN413", "venue-gone-b", "MON", "09:30", "10:30"),
      ]),
    );
    const outcome = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))
      .validation;

    if (outcome.status !== "incomplete") {
      throw new Error(`expected an incomplete outcome, got "${outcome.status}"`);
    }
    expect(types(outcome.violations)).toEqual(["LECTURER_OVERLAP", "GROUP_OVERLAP"]);
    expect(outcome.missingContext.map((error) => error.kind)).toEqual([
      "MISSING_VENUE",
      "MISSING_VENUE",
    ]);
    expect(outcome.missingContext.map((error) => error.entryIndex)).toEqual([0, 1]);
  });

  it("names a missing teaching before a missing venue for the same entry", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-gone", "venue-gone", "MON", "09:00", "10:00")]),
    );
    const outcome = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))
      .validation;

    if (outcome.status !== "incomplete") {
      throw new Error("expected an incomplete outcome");
    }
    expect(outcome.missingContext.map((error) => error.kind)).toEqual([
      "MISSING_TEACHING",
      "MISSING_VENUE",
    ]);
  });

  it("reports an entry id such as __proto__ as missing, never as resolved data", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "__proto__", "venue-CR1", "MON", "09:00", "10:00")]),
    );
    const result = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID));
    const outcome = result.validation;

    if (outcome.status !== "incomplete") {
      throw new Error(`expected an incomplete outcome, got "${outcome.status}"`);
    }
    expect(outcome.missingContext[0].refId).toBe("__proto__");
    expect(result.entries[0].unitCode).toBeNull();
  });

  it("indexes missing context by the sorted position the editor uses", async () => {
    const fake = createFakeStore(
      baseData([
        makeEntry("e-late", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "10:00", "11:00"),
        makeEntry("e-early", "teach-gone", "venue-CR1", "MON", "08:00", "09:00"),
      ]),
    );
    const outcome = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID))
      .validation;

    if (outcome.status !== "incomplete") {
      throw new Error("expected an incomplete outcome");
    }
    expect(outcome.missingContext[0].entryId).toBe("e-early");
    expect(outcome.missingContext[0].entryIndex).toBe(0);
  });

  it("leaves an unresolved row visible with null codes instead of dropping it", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-gone", "venue-gone", "MON", "09:00", "10:00")]),
    );
    const result = expectOk(await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID));

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].unitCode).toBeNull();
    expect(result.entries[0].venueCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

describe("loadDraftForValidation policy", () => {
  it("applies DEFAULT_POLICY when no policy is passed", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "TUE", "16:00", "18:00")]),
    );
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID),
    );

    expect(types(violations)).toEqual(["OUT_OF_SLOT"]);
    expect(DEFAULT_POLICY.slotEnd).toBe("17:00");
  });

  it("accepts an injected policy without changing the validator", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "TUE", "16:00", "18:00")]),
    );
    const violations = expectComplete(
      await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID, {
        ...DEFAULT_POLICY,
        slotEnd: "18:00",
      }),
    );

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store failures
// ---------------------------------------------------------------------------

describe("loadDraftForValidation store failures", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  for (const method of STORE_METHODS) {
    it(`turns a ${method} failure into an error, never a clean or empty result`, async () => {
      const fake = loadSingle(
        makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "09:00", "10:00"),
        { failOn: method },
      );
      const result = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);

      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect("entries" in result).toBe(false);
      expect("validation" in result).toBe(false);
    });
  }

  it("never reports a lecturer-availability read failure as an unconflicted draft", async () => {
    const fake = createFakeStore(
      baseData([makeEntry("e1", "teach-SE-Y4-SOEN413", "venue-CR1", "MON", "15:00", "16:00")]),
      { failOn: "listLecturerUnavailableByLecturerIds" },
    );
    const result = await loadDraftForValidation(fake.store, officer, TEST_VERSION_ID);

    expect(result.ok).toBe(false);
    expect(fake.calls.listLecturerUnavailableByLecturerIds).toBe(1);
  });
});
