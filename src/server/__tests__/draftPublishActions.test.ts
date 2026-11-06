/**
 * M4-T3c1 — the publish server action exposing the accepted performDraftPublish()
 * service to the officer's browser.
 *
 * Following draftGenerateActions/moveActions/addActions: next/headers, the session
 * helper and the Prisma publish-store factory are mocked and a fake implementing
 * the real DraftPublishStore contract is injected. The shipped service and the
 * accepted M3 validator run on top of it, so no fake rule can contradict accepted
 * behaviour. The fake counts every call, mirrors its transaction (status re-check,
 * fingerprint recomputation with the accepted contract helper, same-semester
 * scoping, audit only on commit) and can inject a competing write at commit time;
 * the factory is itself a mock, so every refusal also proves the stronger claim:
 * no Prisma store object was ever created. What this suite does NOT claim: no real
 * SQLite transaction, commit or rollback — that is M4-T3b
 * (draftPublishStorePrisma.test.ts, 38 tests against temp-file databases).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { SafeUser } from "@/server/auth";
import type { TimetableVersionStatus, UserRole } from "@/domain/types";
import type { DraftEntryRow, LecturerUnavailableRow, TeachingRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import {
  publishSnapshotFingerprint, type DraftPublishStore, type PublishAuditDraft, type PublishSnapshot, type PublishTransactionInput, type PublishVersionRow,
} from "@/server/draftPublishContract";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createDraftPublishStore: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/draftPublishStorePrisma", () => ({ createDraftPublishStore: mocks.createDraftPublishStore }));

import { publishDraftAction } from "@/app/officer/draft/publishActions";

// --- Session users: the actor is always the session, never the payload -----

const officer: SafeUser = { id: "user-officer", name: "Timetabling Officer", email: "officer@demo.tams.test", role: "OFFICER", departmentId: null, studentGroupId: null };
const userForRole = (role: UserRole): SafeUser => ({
  id: `user-${role.toLowerCase()}`, name: `${role} user`, email: `${role.toLowerCase()}@demo.tams.test`, role, departmentId: null, studentGroupId: null });

// --- Fixtures --------------------------------------------------------------

const TARGET = "ver-draft-s1";
const versionOf = (over: Partial<PublishVersionRow> = {}): PublishVersionRow => ({ id: TARGET, semester: 1, status: "DRAFT", publishedAt: null, ...over });
const teachingOf = (id: string, over: Partial<TeachingRow> = {}): TeachingRow => ({ id, lecturerId: "lect-A", groupId: "group-1", expectedSize: 40, unitCode: `U-${id}`, venueTypeRequired: "ROOM", ...over });
const venueOf = (id: string, code: string, capacity: number, type: string): VenueRow => ({ id, code, capacity, type });
const entryOf = (id: string, over: Partial<DraftEntryRow> = {}): DraftEntryRow => ({ id, versionId: TARGET, teachingId: "t-a", venueId: "v-1", day: "MON", start: "08:00", end: "09:00", locked: false, ...over });
const published = (id: string, semester: number, at: string) => versionOf({ id, semester, status: "PUBLISHED", publishedAt: new Date(at) });

/** MON 08:00 t-a@CR1 and TUE 08:00 t-b@CR2: complete, in slot, clash-free, plus one
 *  PUBLISHED version per semester so a success has something to archive. */
const baseData = () => ({
  versions: [versionOf(), published("ver-pub-s1", 1, "2026-01-05T08:00:00.000Z"), published("ver-pub-s2", 2, "2026-01-06T08:00:00.000Z")],
  entries: [entryOf("e-1"), entryOf("e-2", { teachingId: "t-b", venueId: "v-2", day: "TUE" })],
  teachings: [teachingOf("t-a"), teachingOf("t-b", { lecturerId: "lect-B", groupId: "group-2" })],
  venues: [venueOf("v-1", "CR1", 60, "ROOM"), venueOf("v-2", "CR2", 50, "ROOM")],
  lecturerUnavailable: [] as LecturerUnavailableRow[], venueUnavailable: [] as VenueUnavailableRow[] });
type FakeData = ReturnType<typeof baseData>;

const rowOf = (data: FakeData, id: string) => data.versions.find((row) => row.id === id);
const publishedIn = (data: FakeData, semester: number) => data.versions.filter((r) => r.status === "PUBLISHED" && r.semester === semester);
const idsOf = (ids: readonly string[]) => [...ids].sort().join(";");
const pick = <T>(rows: T[], ids: readonly string[], key: (row: T) => string) => rows.filter((row) => ids.includes(key(row)));

/** Changes one stored row; a fixture missing the named row is a broken test. */
function patch<T extends { id: string }>(rows: T[], id: string, over: Partial<T>): void {
  const row = rows.find((c) => c.id === id);
  if (row === undefined) throw new Error(`fixture is missing ${id}`);
  Object.assign(row, over); }

/** The same scoping the accepted service applies, rebuilt from current rows. */
function snapshotOf(data: FakeData, version: PublishVersionRow, policy: typeof DEFAULT_POLICY): PublishSnapshot {
  const entries = data.entries.filter((row) => row.versionId === version.id);
  const teachings = pick(data.teachings, entries.map((row) => row.teachingId), (row) => row.id);
  const venues = pick(data.venues, entries.map((row) => row.venueId), (row) => row.id);
  return { version, entries, teachings, venues, policy,
    lecturerUnavailable: pick(data.lecturerUnavailable, teachings.map((r) => r.lecturerId), (r) => r.lecturerId),
    venueUnavailable: pick(data.venueUnavailable, venues.map((r) => r.id), (r) => r.venueId) }; }

// --- Fake store + wiring ---------------------------------------------------

/** A message of the shape a real Prisma/SQLite failure carries: SQL, a
 *  credential-bearing URL and a fingerprint. None of it may reach a log. */
const LEAK_PROBE = 'Failed: SELECT "TimetableVersion"."id" FROM "TimetableVersion" -- postgres://tams:hunter2@db.internal:5432/tams snapshotFingerprint=["version",[["ver-draft-s1",1,"DRAFT",null]]]';

type FakeOptions = { race?: (data: FakeData) => void; throwOn?: keyof DraftPublishStore; leak?: boolean };
type FakeStore = DraftPublishStore & { calls: string[]; data: FakeData; writes: PublishTransactionInput[]; audits: PublishAuditDraft[] };

function fakeStore(build?: (data: FakeData) => void, options: FakeOptions = {}): FakeStore {
  const data = baseData();
  build?.(data);
  const store: FakeStore = {
    calls: [], data, writes: [], audits: [],
    findVersion: async (versionId) => { gate("findVersion"); return rowOf(data, versionId) ?? null; },
    listEntriesByVersion: async (versionId) => { gate("listEntriesByVersion"); return data.entries.filter((r) => r.versionId === versionId); },
    listTeachingsByIds: async (ids) => { gate("listTeachingsByIds"); return pick(data.teachings, ids, (r) => r.id); },
    listVenuesByIds: async (ids) => { gate("listVenuesByIds"); return pick(data.venues, ids, (r) => r.id); },
    listLecturerUnavailableByLecturerIds: async (ids) => { gate("listLecturerUnavailableByLecturerIds"); return pick(data.lecturerUnavailable, ids, (r) => r.lecturerId); },
    listVenueUnavailableByVenueIds: async (ids) => { gate("listVenueUnavailableByVenueIds"); return pick(data.venueUnavailable, ids, (r) => r.venueId); },
    listPublishedVersionsBySemester: async (semester) => { gate("listPublishedVersionsBySemester"); return publishedIn(data, semester); },
    publishDraft: async (input) => {
      gate("publishDraft");
      options.race?.(data);
      store.writes.push(input);
      const version = rowOf(data, input.versionId);
      if (version === undefined) return { stale: true, reason: "VERSION_NOT_FOUND" };
      if (version.status !== "DRAFT") return { stale: true, reason: "VERSION_NOT_DRAFT" };
      if (publishSnapshotFingerprint(snapshotOf(data, version, input.expected.policy)) !== input.expected.snapshotFingerprint) return { stale: true, reason: "SNAPSHOT_CHANGED" };
      const atCommit = publishedIn(data, version.semester);
      if (idsOf(atCommit.map((r) => r.id)) !== idsOf(input.expected.publishedVersionIds)) return { stale: true, reason: "PUBLISHED_SET_CHANGED" };
      // Commit: archive that semester's published versions, publish the target,
      // audit it. Entries are never touched and nothing is deleted.
      const archivedVersionIds = atCommit.map((r) => r.id).sort();
      for (const previous of atCommit) previous.status = "ARCHIVED";
      version.status = "PUBLISHED";
      version.publishedAt = input.publishedAt;
      store.audits.push(input.audit);
      return { ok: true, archivedVersionIds }; }, };
  return store;

  function gate(name: keyof DraftPublishStore) {
    store.calls.push(name);
    if (options.throwOn === name) throw new Error(options.leak === true ? LEAK_PROBE : "store down"); }
}

let store: FakeStore;
const sameOriginHeaders = () => new Headers({ origin: "http://localhost:3000", host: "localhost:3000" });
function install(build?: (data: FakeData) => void, options: FakeOptions = {}) {
  store = fakeStore(build, options);
  mocks.createDraftPublishStore.mockReturnValue(store); }
beforeEach(() => {
  vi.clearAllMocks();
  install();
  mocks.headers.mockResolvedValue(sameOriginHeaders());
  mocks.getCurrentUser.mockResolvedValue(officer); });

/** The proof requirement 3 asks for: no store object exists, so no read ran. */
function expectNoStore() {
  expect(mocks.createDraftPublishStore).not.toHaveBeenCalled();
  expect(store.calls).toEqual([]); expectNoCommit(); }
/** Nothing refused may have committed anything. */
function expectNoCommit() { expect(store.writes).toHaveLength(0); expect(store.audits).toHaveLength(0); }
const validInput = () => ({ versionId: TARGET });
const statusOf = (data: FakeData, id: string) => rowOf(data, id)?.status;
const anyString = expect.any(String) as unknown as string;
const anyDate = expect.any(Date) as unknown as Date;

// --- 1–8: enforcement order — nothing reaches the database -----------------

describe("publishDraftAction enforcement order", () => {
  it.each([
    { name: "a mismatched Origin", headers: new Headers({ origin: "http://attacker.example", host: "localhost:3000" }) },
    { name: "a Sec-Fetch-Site of cross-site", headers: new Headers({ "sec-fetch-site": "cross-site" }) },
  ])("refuses $name before the session or the store is read", async ({ headers }) => {
    mocks.headers.mockResolvedValue(headers);
    expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expectNoStore();
  });

  it("returns UNAUTHENTICATED with no session and creates no store", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectNoStore();
  });

  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER", "ADMIN"] as UserRole[])(
    "refuses a %s caller as FORBIDDEN with the store never constructed", async (role) => {
      mocks.getCurrentUser.mockResolvedValue(userForRole(role));
      expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "FORBIDDEN" });
      expectNoStore(); });

  it("refuses a forbidden role even when the payload names an officer", async () => {
    // Authorization runs before the shape check, so a forged actor field cannot
    // even reach validation, let alone grant publication.
    mocks.getCurrentUser.mockResolvedValue(userForRole("STUDENT"));
    expect(await publishDraftAction({ ...validInput(), actorId: officer.id, role: "OFFICER", status: "PUBLISHED" }))
      .toEqual({ ok: false, kind: "FORBIDDEN" });
    expectNoStore();
  });

  it("lets the authorised officer through to the accepted service", async () => {
    expect(await publishDraftAction(validInput())).toMatchObject({ ok: true, versionId: TARGET });
    expect(mocks.createDraftPublishStore).toHaveBeenCalledTimes(1);
    expect(store.calls).toContain("publishDraft");
    expect(store.audits).toHaveLength(1);
  });
});

// --- 9–16: the request boundary (versionId is the only field) --------------

describe("publishDraftAction input boundary", () => {
  it.each([
    { name: "a missing version id", input: {} }, { name: "a blank version id", input: { versionId: "" } },
    { name: "a whitespace-only version id", input: { versionId: "   " } }, { name: "a null version id", input: { versionId: null } },
    { name: "a non-string version id", input: { versionId: 42 } }, { name: "an array version id", input: { versionId: [TARGET] } },
    { name: "no input at all", input: undefined }, { name: "a bare string", input: TARGET }, { name: "a null input", input: null },
  ])("rejects $name as INVALID_INPUT with zero store calls", async ({ input }) => {
    expect(await publishDraftAction(input)).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
    expectNoStore(); });

  it.each(["actorId", "createdBy", "role", "status", "publishedAt", "semester", "archivedVersionIds", "snapshotFingerprint", "userId", "expectedSource"])(
    "rejects a payload carrying the forged field %s and never echoes it back", async (key) => {
      const result = await publishDraftAction({ ...validInput(), [key]: "attacker" });
      expect(result).toMatchObject({ ok: false, kind: "INVALID_INPUT" });
      expect(JSON.stringify(result)).not.toContain("attacker");
      expectNoStore(); });

  it("rejects a forged lifecycle bundle, not only single fields", async () => {
    const result = await publishDraftAction({ versionId: TARGET, actorId: "user-attacker", role: "OFFICER", status: "PUBLISHED",
      publishedAt: "2026-01-01T00:00:00.000Z", semester: 2, archivedVersionIds: ["ver-pub-s1"], snapshotFingerprint: '["forged"]' });
    expect(result).toEqual({ ok: false, kind: "INVALID_INPUT", message: anyString });
    if (result.ok || result.kind !== "INVALID_INPUT") return;
    expect(result.message).toContain("may only carry the draft version id");
    expectNoStore();
  });

  it("accepts a valid version id and trims padding before the service sees it", async () => {
    expect(await publishDraftAction({ versionId: `  ${TARGET}  ` })).toMatchObject({ ok: true, versionId: TARGET });
    expect(store.writes[0]?.versionId).toBe(TARGET);
  });
});

// --- 17–18: what actually reaches the accepted service ---------------------

describe("publishDraftAction service hand-off", () => {
  it("takes the actor from the session, never from the request", async () => {
    expect(await publishDraftAction(validInput())).toMatchObject({ ok: true });
    expect(store.writes[0]?.audit).toEqual({ actorId: officer.id, action: "TIMETABLE_PUBLISH", entity: "TimetableVersion", reason: anyString });
    expect(store.writes[0]?.audit.actorId).not.toBe("attacker");
  });

  it("stamps the publication with the server clock, not a supplied time", async () => {
    const before = Date.now();
    const result = await publishDraftAction(validInput());
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(store.writes[0]?.publishedAt).toEqual(result.publishedAt);
    expect(result.publishedAt instanceof Date).toBe(true);
    expect(result.publishedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.publishedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("creates no store for any denied or malformed request", async () => {
    const denied: unknown[] = [];
    mocks.headers.mockResolvedValue(new Headers({ origin: "http://attacker.example", host: "localhost:3000" }));
    denied.push(await publishDraftAction(validInput()));
    mocks.headers.mockResolvedValue(sameOriginHeaders());
    mocks.getCurrentUser.mockResolvedValue(null);
    denied.push(await publishDraftAction(validInput()));
    for (const role of ["STUDENT", "LECTURER", "DEPT_REP", "APPROVER", "ADMIN"] as UserRole[]) {
      mocks.getCurrentUser.mockResolvedValue(userForRole(role));
      denied.push(await publishDraftAction(validInput())); }
    mocks.getCurrentUser.mockResolvedValue(officer);
    for (const input of [{}, { versionId: "  " }, { actorId: "attacker" }, { versionId: TARGET, publishedAt: "2020-01-01" }]) {
      denied.push(await publishDraftAction(input)); }
    for (const result of denied) {
      expect(result).toMatchObject({ ok: false });
      expect(["FORBIDDEN", "UNAUTHENTICATED", "INVALID_INPUT"]).toContain((result as { kind: string }).kind); }
    expectNoStore();
  });
});

// --- 19–24: typed results propagate unchanged and are never over-claimed ---

describe("publishDraftAction result propagation", () => {
  it("returns the service success object exactly — the ids it actually archived", async () => {
    const result = await publishDraftAction(validInput());
    expect(result).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: ["ver-pub-s1"], publishedAt: anyDate });
    expect(Object.keys(result).sort()).toEqual(["archivedVersionIds", "ok", "publishedAt", "semester", "versionId"]);
    expect(statusOf(store.data, "ver-pub-s1")).toBe("ARCHIVED");
    expect(statusOf(store.data, "ver-pub-s2")).toBe("PUBLISHED");
  });

  it("publishes a first draft with nothing to archive and still reports the empty set", async () => {
    install((d) => { d.versions = [versionOf()]; });
    expect(await publishDraftAction(validInput())).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: [], publishedAt: anyDate }); });

  it("propagates HARD_VIOLATIONS without presenting the draft as published", async () => {
    // e-3 puts two classes in v-1 on MON: an accepted M3 venue clash.
    install((d) => d.entries.push(entryOf("e-3", { teachingId: "t-b", venueId: "v-1", day: "MON" })));
    const result = await publishDraftAction(validInput());
    if (result.ok || result.kind !== "HARD_VIOLATIONS") throw new Error(`expected HARD_VIOLATIONS, got ${JSON.stringify(result)}`);
    expect(result.versionId).toBe(TARGET);
    expect(result.violations.map((v) => v.type)).toContain("VENUE_OVERLAP");
    expect(result.violations.every((v) => v.message.length > 20)).toBe(true);
    expect(store.calls).not.toContain("publishDraft");
    expectNoCommit();
    expect([statusOf(store.data, TARGET), statusOf(store.data, "ver-pub-s1")]).toEqual(["DRAFT", "PUBLISHED"]); });

  it("propagates INCOMPLETE_VALIDATION with its missing-context details", async () => {
    install((d) => { d.entries = [entryOf("e-1")]; d.teachings = []; });
    const result = await publishDraftAction(validInput());
    if (result.ok || result.kind !== "INCOMPLETE_VALIDATION") throw new Error(`expected INCOMPLETE_VALIDATION, got ${JSON.stringify(result)}`);
    expect([result.violations, result.missingContext.map((m) => m.kind)]).toEqual([[], ["MISSING_TEACHING"]]);
    expectNoCommit(); });

  it("propagates EMPTY_DRAFT for a DRAFT with no rows of its own", async () => {
    install((d) => d.entries.splice(0));
    expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "EMPTY_DRAFT", versionId: TARGET });
    expect(store.calls).toEqual(["findVersion", "listEntriesByVersion"]);
    expectNoCommit(); });

  it.each(["PUBLISHED", "ARCHIVED"] as TimetableVersionStatus[])(
    "propagates NOT_DRAFT for a %s target and leaves its row alone", async (status) => {
      install((d) => patch(d.versions, TARGET, { status }));
      expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: TARGET, storedStatus: status });
      expectNoCommit(); });

  it("propagates VERSION_NOT_FOUND for an id the store cannot resolve", async () => {
    expect(await publishDraftAction({ versionId: "ver-ghost" })).toEqual({ ok: false, kind: "VERSION_NOT_FOUND", versionId: "ver-ghost" });
    expectNoCommit(); });

  it.each([
    { name: "a semester outside the prototype", build: (d: FakeData) => patch(d.versions, TARGET, { semester: 7 }), reason: "SEMESTER_OUT_OF_RANGE" },
    { name: "a DRAFT already carrying a publication time", build: (d: FakeData) => patch(d.versions, TARGET, { publishedAt: new Date() }), reason: "PUBLISHED_AT_ON_DRAFT" },
  ])("propagates INVALID_VERSION_DATA for $name with its reason", async ({ build, reason }) => {
    install(build);
    const result = await publishDraftAction(validInput());
    if (result.ok || result.kind !== "INVALID_VERSION_DATA") throw new Error(`expected INVALID_VERSION_DATA, got ${JSON.stringify(result)}`);
    expect([result.versionId, result.reason, result.message.length > 20]).toEqual([TARGET, reason, true]);
    expectNoCommit(); });

  it.each([
    { name: "an entry moved under the officer", race: (d: FakeData) => patch(d.entries, "e-1", { day: "THU" }), reason: "SNAPSHOT_CHANGED" },
    { name: "a venue losing capacity", race: (d: FakeData) => patch(d.venues, "v-1", { capacity: 10 }), reason: "SNAPSHOT_CHANGED" },
    { name: "the draft published by someone else", race: (d: FakeData) => { const t = rowOf(d, TARGET); if (t !== undefined) t.status = "PUBLISHED"; }, reason: "VERSION_NOT_DRAFT" },
    { name: "a rival draft published for this semester", race: (d: FakeData) => d.versions.push(published("ver-rival", 1, "2026-01-07T08:00:00.000Z")), reason: "PUBLISHED_SET_CHANGED" },
  ])("propagates STALE with the original reason when $name lands before the commit", async ({ race, reason }) => {
    install(undefined, { race });
    expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "STALE", reason });
    expect(store.audits).toHaveLength(0);
    expect(rowOf(store.data, TARGET)?.publishedAt).toBeNull(); });
});

// --- 25–26: unexpected failures, and nothing sensitive left behind ---------

describe("publishDraftAction failure handling", () => {
  it.each(["findVersion", "listEntriesByVersion", "listTeachingsByIds", "listVenuesByIds",
    "listLecturerUnavailableByLecturerIds", "listVenueUnavailableByVenueIds", "listPublishedVersionsBySemester", "publishDraft"] as (keyof DraftPublishStore)[])(
    "converts a service-path store failure on %s to a safe INTERNAL_ERROR", async (throwOn) => {
      install(undefined, { throwOn });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(await publishDraftAction(validInput())).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
        expectNoCommit();
      } finally { errorLog.mockRestore(); } });

  it("converts an unexpected store-factory failure to INTERNAL_ERROR and logs only the fixed line", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createDraftPublishStore.mockImplementation(() => { throw new Error(LEAK_PROBE); });
    try {
      const result = await publishDraftAction(validInput());
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(JSON.stringify(result)).not.toMatch(/postgres|hunter2|db\.internal|SELECT|snapshotFingerprint/i);
      // One fixed operational message, byte for byte: no exception text, no stack
      // frame (neither "Error" nor "at " occurs in it), no payload.
      const logged = errorLog.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toBe("[officer/draft] publish action failed; returning INTERNAL_ERROR");
      expect(logged).not.toContain(JSON.stringify(validInput()));
      // The factory threw, so the service never received a store and no read ran.
      expect(store.calls).toEqual([]);
    } finally { errorLog.mockRestore(); } });

  it("keeps credentials, SQL and the fingerprint out of the service-path failure log", async () => {
    install(undefined, { throwOn: "publishDraft", leak: true });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await publishDraftAction(validInput());
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(JSON.stringify(result)).not.toContain("hunter2");
      // The service's own fixed line only: the action does not re-log what the
      // service already reported, and neither adds any exception detail.
      expect(errorLog.mock.calls.map((call) => call.join(" ")).join("\n"))
        .toBe("[draftPublish] publication failed; returning INTERNAL_ERROR");
      expectNoCommit();
    } finally { errorLog.mockRestore(); } });
});
