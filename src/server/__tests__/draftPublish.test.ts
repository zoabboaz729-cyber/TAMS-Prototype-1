/**
 * M4-T3a — the secure publication service, tested against an injected fake
 * store: no database, no real writes. The fake counts every call, mirrors the
 * transaction it stands in for (status re-check, snapshot fingerprint
 * recomputation with the accepted contract helper, same-semester scoping, audit
 * only on commit) and can inject a competing write at commit time, so a stale
 * refusal proves the token really is what stopped the commit. Covers the
 * bundle's 28 required scenarios, and the eight hard-constraint refusals run
 * the accepted `validateEntries()` on controlled fixtures — never a mocked
 * validator.
 */
import { describe, expect, it } from "vitest";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy";
import type { TimetableVersionStatus, UserRole } from "@/domain/types";
import type { ViolationType } from "@/domain/validator";
import type { DraftEntryRow, LecturerUnavailableRow, TeachingRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import { performDraftPublish } from "@/server/draftPublish";
import { publishSnapshotFingerprint, type DraftPublishStore, type PublishDraftRequest, type PublishAuditDraft, type PublishSnapshot, type PublishTransactionInput, type PublishVersionRow } from "@/server/draftPublishContract";

// --- Fixtures -------------------------------------------------------------

const officer: Actor = { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const forbiddenRoles: UserRole[] = ["ADMIN", "DEPT_REP", "APPROVER", "LECTURER", "STUDENT"];
const TARGET = "ver-draft-s1";
const REQUEST = { versionId: TARGET };
const CLOCK = new Date("2026-11-06T09:00:00.000Z");

const versionOf = (over: Partial<PublishVersionRow> = {}): PublishVersionRow => ({ id: TARGET, semester: 1, status: "DRAFT", publishedAt: null, ...over });
const teachingOf = (id: string, over: Partial<TeachingRow> = {}): TeachingRow => ({ id, lecturerId: "lect-A", groupId: "group-1", expectedSize: 40, unitCode: `U-${id}`, venueTypeRequired: "ROOM", ...over });
const venueOf = (id: string, code: string, capacity: number, type: string): VenueRow => ({ id, code, capacity, type });
const entryOf = (id: string, over: Partial<DraftEntryRow> = {}): DraftEntryRow => ({ id, versionId: TARGET, teachingId: "t-a", venueId: "v-1", day: "MON", start: "08:00", end: "09:00", locked: false, ...over });
const lecturerBlocked = (lecturerId: string, day: string, start: string, end: string): LecturerUnavailableRow => ({ id: `la-${lecturerId}-${day}`, lecturerId, day, start, end, available: false });
const venueClosed = (venueId: string, day: string, start: string, end: string): VenueUnavailableRow => ({ id: `vu-${venueId}-${day}`, venueId, day, start, end, reason: "exam" });

/** A DRAFT with one PUBLISHED sibling in each semester, unless a test says otherwise. */
const others = (): PublishVersionRow[] => [
  versionOf({ id: "ver-pub-s1", status: "PUBLISHED", publishedAt: new Date("2026-01-05T08:00:00.000Z") }),
  versionOf({ id: "ver-pub-s2", semester: 2, status: "PUBLISHED", publishedAt: new Date("2026-01-06T08:00:00.000Z") })];

type FakeData = {
  versions: PublishVersionRow[]; entries: DraftEntryRow[]; teachings: TeachingRow[]; venues: VenueRow[];
  lecturerUnavailable: LecturerUnavailableRow[]; venueUnavailable: VenueUnavailableRow[] };

/** MON 08:00 t-a@CR1 and TUE 08:00 t-b@CR2: complete, in slot, no clash. CR9 is
 *  deliberately too small for a 40-seat group, and t-d (added only by the
 *  VENUE_TYPE fixture) is the LAB-required unit, so the CAPACITY fixture and
 *  the VENUE_TYPE fixture each break exactly one hard rule. */
const baseData = (): FakeData => ({
  versions: [versionOf(), ...others()],
  entries: [entryOf("e-1"), entryOf("e-2", { teachingId: "t-b", venueId: "v-2", day: "TUE" })],
  teachings: [teachingOf("t-a"), teachingOf("t-b", { lecturerId: "lect-B", groupId: "group-2" })],
  venues: [venueOf("v-1", "CR1", 60, "ROOM"), venueOf("v-2", "CR2", 50, "ROOM"), venueOf("v-sm", "CR9", 20, "ROOM")],
  lecturerUnavailable: [], venueUnavailable: [] });

const rowOf = (data: FakeData, id: string) => data.versions.find((row) => row.id === id);
const publishedIn = (data: FakeData, semester: number) => data.versions.filter((row) => row.status === "PUBLISHED" && row.semester === semester);
const idsOf = (ids: readonly string[]) => [...ids].sort().join(";");

/** Changes one stored row in place, leaving every other row of the fixture
 *  untouched. A fixture that lost the named row is a broken test, so this
 *  fails loudly instead of quietly doing nothing. */
function patch<T extends { id: string }>(rows: T[], id: string, over: Partial<T>): void {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`fixture is missing ${id}`);
  Object.assign(row, over);
}
const onTarget = (data: FakeData): PublishVersionRow => {
  const target = rowOf(data, TARGET);
  if (target === undefined) throw new Error(`fixture is missing ${TARGET}`);
  return target; };

// --- Fake store: the injected DraftPublishStore, mirroring its transaction ---

type FakeOptions = {
  /** A committed write that lands after the service's reads, before its commit. */
  race?: (data: FakeData) => void;
  throwOn?: keyof DraftPublishStore };
type FakeStore = DraftPublishStore & { calls: string[]; data: FakeData; writes: PublishTransactionInput[]; audits: PublishAuditDraft[] };

/** The id-filtering a real store applies, so a service read that ignored its
 *  own id list would see rows it must not see. */
const pick = <T>(rows: T[], ids: readonly string[], key: (row: T) => string) => rows.filter((row) => ids.includes(key(row)));

/** The same scoping the service applies, rebuilt from the store's current rows. */
function snapshotOf(data: FakeData, version: PublishVersionRow, policy: PolicyConfig): PublishSnapshot {
  const entries = data.entries.filter((row) => row.versionId === version.id);
  const teachings = pick(data.teachings, entries.map((row) => row.teachingId), (row) => row.id);
  const venues = pick(data.venues, entries.map((row) => row.venueId), (row) => row.id);
  return { version, entries, teachings, venues, policy,
    lecturerUnavailable: pick(data.lecturerUnavailable, teachings.map((row) => row.lecturerId), (row) => row.lecturerId),
    venueUnavailable: pick(data.venueUnavailable, venues.map((row) => row.id), (row) => row.venueId) };
}

function fakeStore(build?: (data: FakeData) => void, options: FakeOptions = {}): FakeStore {
  const data = baseData();
  build?.(data);
  const store: FakeStore = {
    calls: [], data, writes: [], audits: [],
    findVersion: async (versionId) => { gate("findVersion"); return rowOf(data, versionId) ?? null; },
    // Deliberately leaks another version's row: the service must publish only
    // the rows of the version it was asked about.
    listEntriesByVersion: async (versionId) => {
      gate("listEntriesByVersion");
      return data.entries.filter((row) => row.versionId === versionId || row.id === "e-of-another-draft"); },
    listTeachingsByIds: async (ids) => { gate("listTeachingsByIds"); return pick(data.teachings, ids, (row) => row.id); },
    listVenuesByIds: async (ids) => { gate("listVenuesByIds"); return pick(data.venues, ids, (row) => row.id); },
    listLecturerUnavailableByLecturerIds: async (ids) => { gate("listLecturerUnavailableByLecturerIds"); return pick(data.lecturerUnavailable, ids, (row) => row.lecturerId); },
    listVenueUnavailableByVenueIds: async (ids) => { gate("listVenueUnavailableByVenueIds"); return pick(data.venueUnavailable, ids, (row) => row.venueId); },
    listPublishedVersionsBySemester: async (semester) => { gate("listPublishedVersionsBySemester"); return publishedIn(data, semester); },
    publishDraft: async (input) => {
      gate("publishDraft");
      options.race?.(data);
      store.writes.push(input);
      const version = rowOf(data, input.versionId);
      if (version === undefined) return { stale: true, reason: "VERSION_NOT_FOUND" };
      if (version.status !== "DRAFT") return { stale: true, reason: "VERSION_NOT_DRAFT" };
      if (publishSnapshotFingerprint(snapshotOf(data, version, input.expected.policy)) !== input.expected.snapshotFingerprint) {
        return { stale: true, reason: "SNAPSHOT_CHANGED" }; }
      const published = publishedIn(data, version.semester);
      if (idsOf(published.map((row) => row.id)) !== idsOf(input.expected.publishedVersionIds)) {
        return { stale: true, reason: "PUBLISHED_SET_CHANGED" }; }
      // Commit: archive exactly that semester's published versions, publish the
      // target, audit it. Entries are never touched and nothing is deleted.
      const archivedVersionIds = published.map((row) => row.id).sort();
      for (const previous of published) previous.status = "ARCHIVED";
      version.status = "PUBLISHED";
      version.publishedAt = input.publishedAt;
      store.audits.push(input.audit);
      return { ok: true, archivedVersionIds }; },
  };
  return store;

  function gate(name: keyof DraftPublishStore) {
    store.calls.push(name);
    if (options.throwOn === name) throw new Error("store down");
  }
}

// --- Assertion helpers ----------------------------------------------------

/** Nothing that refused may have committed anything. */
const expectNoCommit = (store: FakeStore) => { expect(store.writes).toHaveLength(0); expect(store.audits).toHaveLength(0); };
/** Zero store operations is the proof that authorization ran first. */
const expectUntouched = (store: FakeStore) => { expect(store.calls).toEqual([]); expectNoCommit(store); };

const types = (result: { violations?: { type: string }[] }) => (result.violations ?? []).map((row) => row.type);
const text = (expected: string): string => expect.stringContaining(expected) as unknown as string;
const badRequest = (message: string) => ({ ok: false, kind: "INVALID_INPUT", message: text(message) });
const archivedIds = (data: FakeData) => data.versions.filter((row) => row.status === "ARCHIVED").map((row) => row.id);
const publish = (store: FakeStore) => performDraftPublish(store, officer, REQUEST, DEFAULT_POLICY, () => CLOCK);

// --- 1, 2 and 3: authorization before any read ----------------------------

describe("authorization", () => {
  it("refuses an unauthenticated or forbidden caller with zero store operations", async () => {
    const actors: (Actor | null)[] = [null, ...forbiddenRoles.map((role): Actor => ({ id: `user-${role}`, role, departmentId: null, studentGroupId: null }))];
    for (const actor of actors) {
      const store = fakeStore();
      expect(await performDraftPublish(store, actor, REQUEST)).toEqual({ ok: false, kind: actor === null ? "UNAUTHENTICATED" : "FORBIDDEN" });
      expectUntouched(store);
    }
  });

  it("never lets a request field carry identity, status or a publication time", async () => {
    for (const forged of [{ actorId: "user-attacker", role: "OFFICER" },
      { status: "PUBLISHED", publishedAt: "2026-01-01T00:00:00.000Z", createdBy: "user-attacker" }]) {
      const store = fakeStore();
      expect(await performDraftPublish(store, officer, { ...REQUEST, ...forged } as PublishDraftRequest)).toEqual(badRequest("only carry the draft version id"));
      expectUntouched(store);
    }
    // With no session at all, the same forged body still gets UNAUTHENTICATED.
    const store = fakeStore();
    expect(await performDraftPublish(store, null, { ...REQUEST, role: "OFFICER" } as typeof REQUEST)).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expectUntouched(store);
  });

  it("lets the authorised officer through to the atomic commit", async () => {
    const store = fakeStore();
    expect((await publish(store)).ok).toBe(true);
    expect(store.calls).toContain("publishDraft");
    expect(store.audits).toHaveLength(1);
  });
});

// --- 4 and 5: the request is validated before the database ----------------

describe("request validation", () => {
  it("refuses a missing or blank version id before reading anything", async () => {
    for (const versionId of ["", "   "]) {
      const store = fakeStore();
      expect(await performDraftPublish(store, officer, { versionId })).toEqual(badRequest("Choose the draft version"));
      expectUntouched(store);
    }
  });

  it("refuses a malformed request before reading anything", async () => {
    for (const request of [{}, { versionId: 42 }, null, undefined, "ver-draft-s1"] as unknown[]) {
      const store = fakeStore();
      expect(await performDraftPublish(store, officer, request as PublishDraftRequest)).toEqual(
        { ok: false, kind: "INVALID_INPUT", message: expect.any(String) as unknown as string });
      expectUntouched(store);
    }
  });
});

// --- 6, 7, 8 and unreadable status ---------------------------------------

describe("target version status", () => {
  it("refuses a version that does not exist", async () => {
    const store = fakeStore();
    expect(await performDraftPublish(store, officer, { versionId: "nope" })).toEqual({ ok: false, kind: "VERSION_NOT_FOUND", versionId: "nope" });
    expect(store.calls).toEqual(["findVersion"]);
    expectNoCommit(store);
  });

  for (const status of ["PUBLISHED", "ARCHIVED"] as TimetableVersionStatus[]) {
    it(`refuses a ${status.toLowerCase()} target and never rewrites it`, async () => {
      const store = fakeStore((d) => patch(d.versions, TARGET, { status }));
      expect(await publish(store)).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: TARGET, storedStatus: status });
      expect(store.calls).toEqual(["findVersion"]);
      expect([onTarget(store.data).status, onTarget(store.data).publishedAt]).toEqual([status, null]);
      expectNoCommit(store);
    });
  }

  it("refuses a version whose stored data contradicts itself", async () => {
    const semesterStore = fakeStore((d) => patch(d.versions, TARGET, { semester: 7 }));
    expect(await publish(semesterStore)).toEqual({ ok: false, kind: "INVALID_VERSION_DATA", versionId: TARGET,
      reason: "SEMESTER_OUT_OF_RANGE", message: text("not a semester this prototype knows") });
    expect(semesterStore.calls).toEqual(["findVersion"]);

    const stampedStore = fakeStore((d) => patch(d.versions, TARGET, { publishedAt: CLOCK }));
    expect(await publish(stampedStore)).toEqual({ ok: false, kind: "INVALID_VERSION_DATA", versionId: TARGET,
      reason: "PUBLISHED_AT_ON_DRAFT", message: text("inconsistent") });
    expectNoCommit(stampedStore);
  });

  it("reports an unreadable stored status as INTERNAL_ERROR instead of guessing", async () => {
    // The M4-T2b adapter parses the stored status and throws on a value outside
    // TIMETABLE_VERSION_STATUSES, which is exactly what `findVersion` fails with.
    const store = fakeStore(undefined, { throwOn: "findVersion" });
    expect(await publish(store)).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expectNoCommit(store);
  });
});

// --- 9: an empty DRAFT is never published --------------------------------

describe("empty draft", () => {
  it("refuses a DRAFT with zero entries without loading any context", async () => {
    const store = fakeStore((d) => d.entries.splice(0));
    expect(await publish(store)).toEqual({ ok: false, kind: "EMPTY_DRAFT", versionId: TARGET });
    expect(store.calls).toEqual(["findVersion", "listEntriesByVersion"]);
    expectNoCommit(store);
  });

  it("refuses a draft whose only rows belong to another version", async () => {
    const store = fakeStore((d) => d.entries.forEach((row) => { row.versionId = "ver-someone-else"; }));
    expect(await publish(store)).toEqual({ ok: false, kind: "EMPTY_DRAFT", versionId: TARGET });
    expectNoCommit(store);
  });

  it("publishes only the target's own rows when the entry read leaks another draft", async () => {
    // `listEntriesByVersion` always leaks e-of-another-draft, so the fixture's
    // two rows are the only ones this publication may count or archive.
    const store = fakeStore();
    expect(await publish(store)).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: ["ver-pub-s1"], publishedAt: CLOCK });
    expect(store.audits[0]?.reason).toContain("Published 2 entries");
  });
});

// --- 10 through 18, 19 and 28: the mandatory final M3 validation ---------

describe("mandatory final validation", () => {
  /** [what the fixture breaks, how, the violation type the accepted validator names] */
  const breaches: [string, (d: FakeData) => void, ViolationType][] = [
    ["two classes in one venue", (d) => d.entries.push(entryOf("e-3", { teachingId: "t-b", venueId: "v-1", day: "MON" })), "VENUE_OVERLAP"],
    ["one lecturer in two places", (d) => d.entries.push(entryOf("e-3", { teachingId: "t-a", venueId: "v-2", day: "MON" })), "LECTURER_OVERLAP"],
    ["one group in two places", (d) => { d.teachings.push(teachingOf("t-c", { lecturerId: "lect-C" })); d.entries.push(entryOf("e-3", { teachingId: "t-c", venueId: "v-2", day: "MON" })); }, "GROUP_OVERLAP"],
    ["a venue too small for the group", (d) => d.entries.push(entryOf("e-3", { teachingId: "t-a", venueId: "v-sm", day: "WED" })), "CAPACITY"],
    ["a room of the wrong type", (d) => { d.teachings.push(teachingOf("t-d", { venueTypeRequired: "LAB", expectedSize: 20, lecturerId: "lect-D", groupId: "group-4" })); d.entries.push(entryOf("e-3", { teachingId: "t-d", venueId: "v-1", day: "WED", start: "10:00", end: "11:00" })); }, "VENUE_TYPE"],
    ["the lecturer is unavailable", (d) => d.lecturerUnavailable.push(lecturerBlocked("lect-A", "MON", "08:00", "09:00")), "LECTURER_UNAVAILABLE"],
    ["the venue is unavailable", (d) => d.venueUnavailable.push(venueClosed("v-1", "MON", "08:30", "09:30")), "VENUE_UNAVAILABLE"],
    ["a session outside the grid", (d) => d.entries.push(entryOf("e-3", { teachingId: "t-b", venueId: "v-2", day: "SAT" })), "OUT_OF_SLOT"]];

  for (const [label, breach, type] of breaches) {
    it(`refuses publication when ${label}, and never reaches the write`, async () => {
      const store = fakeStore(breach);
      const result = await publish(store);
      if (result.ok || result.kind !== "HARD_VIOLATIONS") throw new Error(`expected HARD_VIOLATIONS, got ${JSON.stringify(result)}`);
      expect(result.versionId).toBe(TARGET);
      expect(types(result)).toContain(type);
      expect(result.violations.every((violation) => violation.message.length > 20)).toBe(true);
      expect(store.calls).not.toContain("publishDraft");
      expectNoCommit(store);
    });
  }

  it("publishes a hard-conflict-free draft and hands the store nothing to rewrite", async () => {
    const store = fakeStore();
    expect(await publish(store)).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: ["ver-pub-s1"], publishedAt: CLOCK });
    // Publication is a status change: every entry row of every version is
    // unchanged and the version list still holds exactly the three it started
    // with — the newly published draft, its archived predecessor (asserted in
    // the lifecycle group) and the other semester's untouched version.
    expect(JSON.stringify(store.data.entries)).toBe(JSON.stringify(baseData().entries));
    expect(store.data.versions).toHaveLength(3);
    expect(store.writes[0].expected.publishedVersionIds).toEqual(["ver-pub-s1"]);
    expect(store.writes[0].publishedAt).toEqual(CLOCK);
    expect(store.writes[0].audit).toEqual({ actorId: "user-officer", action: "TIMETABLE_PUBLISH", entity: "TimetableVersion",
      reason: text("Published 2 entries of draft ver-draft-s1 (semester 1); archived ver-pub-s1") });
  });

  const incomplete: [string, (d: FakeData) => void, string][] = [
    ["its teaching is gone", (d) => { d.entries = [entryOf("e-1")]; d.teachings = []; }, "MISSING_TEACHING"],
    ["its venue is gone", (d) => { d.entries = [entryOf("e-1")]; d.venues = []; }, "MISSING_VENUE"]];

  for (const [label, missing, kind] of incomplete) {
    it(`refuses as INCOMPLETE_VALIDATION when ${label}, even with zero violations`, async () => {
      const store = fakeStore(missing);
      const result = await publish(store);
      if (result.ok || result.kind !== "INCOMPLETE_VALIDATION") throw new Error(`expected INCOMPLETE_VALIDATION, got ${JSON.stringify(result)}`);
      expect(result.violations).toEqual([]);
      expect(result.missingContext.map((row) => row.kind)).toEqual([kind]);
      expect(result.missingContext[0]?.message).toContain("missing from the validation context");
      expectNoCommit(store);
    });
  }

  it("refuses a draft whose unresolved reference hid an otherwise invisible problem", async () => {
    // An extra entry pointing at a teaching the store cannot resolve: every
    // check that needs it is skipped, so only the incomplete status tells this
    // apart from a clean draft.
    const store = fakeStore((d) => d.entries.push(entryOf("e-3", { teachingId: "t-ghost", venueId: "v-2", day: "FRI" })));
    const result = await publish(store);
    if (result.ok || result.kind !== "INCOMPLETE_VALIDATION") throw new Error(`expected INCOMPLETE_VALIDATION, got ${JSON.stringify(result)}`);
    expect(JSON.stringify(result.missingContext)).toContain("t-ghost");
    expectNoCommit(store);
  });
});

// --- 20 and 21: same-semester archiving contract -------------------------

describe("version and semester lifecycle", () => {
  it("archives every PUBLISHED version of the target semester, with its rows intact", async () => {
    const store = fakeStore((d) => {
      d.versions.push(versionOf({ id: "ver-pub-s1b", status: "PUBLISHED", publishedAt: new Date("2026-01-04T08:00:00.000Z") }));
      d.entries.push(entryOf("e-pub-1", { versionId: "ver-pub-s1" }), entryOf("e-pub-2", { versionId: "ver-pub-s2" })); });
    const result = await publish(store);
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.archivedVersionIds).toEqual(["ver-pub-s1", "ver-pub-s1b"]);
    expect(store.writes[0].expected.publishedVersionIds).toEqual(["ver-pub-s1", "ver-pub-s1b"]);
    expect(store.data.versions.map((row) => [row.id, row.status])).toEqual([
      [TARGET, "PUBLISHED"], ["ver-pub-s1", "ARCHIVED"], ["ver-pub-s2", "PUBLISHED"], ["ver-pub-s1b", "ARCHIVED"]]);
    // Archiving changes status only: no entry of any version is deleted or moved,
    // and an archived version keeps the publication time it was published with.
    expect(store.data.entries.map((row) => row.id).sort()).toEqual(["e-1", "e-2", "e-pub-1", "e-pub-2"]);
    expect(rowOf(store.data, "ver-pub-s1")?.publishedAt).toEqual(new Date("2026-01-05T08:00:00.000Z"));
    expect(store.audits[0]?.reason).toContain("ver-pub-s1, ver-pub-s1b");
  });

  it("leaves a published version of another semester entirely alone", async () => {
    const store = fakeStore();
    if (!(await publish(store)).ok) throw new Error("expected success");
    const other = rowOf(store.data, "ver-pub-s2");
    expect([other?.status, other?.publishedAt]).toEqual(["PUBLISHED", new Date("2026-01-06T08:00:00.000Z")]);
    expect(archivedIds(store.data)).not.toContain("ver-pub-s2");
    // And the transaction token never names it, so the adapter cannot archive it either.
    expect(store.writes[0].expected.publishedVersionIds).not.toContain("ver-pub-s2");
    expect(store.writes[0].semester).toBe(1);
  });

  it("publishes a first draft with nothing to archive", async () => {
    const store = fakeStore((d) => { d.versions = [versionOf()]; });
    const result = await publish(store);
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
    expect(result.archivedVersionIds).toEqual([]);
    expect(store.audits[0]?.reason).toContain("archived no earlier version");
  });
});

// --- 22 through 27 and determinism: the concurrency contract -------------

describe("stale protection and failure handling", () => {
  const races: [string, (d: FakeData) => void, "SNAPSHOT_CHANGED" | "VERSION_NOT_DRAFT" | "PUBLISHED_SET_CHANGED"][] = [
    ["an officer moved an entry of this draft", (d) => patch(d.entries, "e-1", { day: "THU" }), "SNAPSHOT_CHANGED"],
    ["a venue lost capacity under an unchanged draft", (d) => patch(d.venues, "v-1", { capacity: 10 }), "SNAPSHOT_CHANGED"],
    ["a lecturer became unavailable under an unchanged draft", (d) => d.lecturerUnavailable.push(lecturerBlocked("lect-A", "MON", "08:00", "09:00")), "SNAPSHOT_CHANGED"],
    ["a venue changed to a type this draft cannot use", (d) => patch(d.venues, "v-2", { type: "LAB" }), "SNAPSHOT_CHANGED"],
    ["another officer published this very draft", (d) => { onTarget(d).status = "PUBLISHED"; }, "VERSION_NOT_DRAFT"],
    ["another officer published a rival draft of this semester", (d) => d.versions.push(versionOf({ id: "ver-rival", status: "PUBLISHED", publishedAt: CLOCK })), "PUBLISHED_SET_CHANGED"]];

  for (const [label, race, reason] of races) {
    it(`refuses as STALE when ${label} between the validation and the commit`, async () => {
      const store = fakeStore(undefined, { race });
      expect(await publish(store)).toEqual({ ok: false, kind: "STALE", reason });
      expect(store.writes).toHaveLength(1);
      // Nothing partial: our commit never ran, so nothing was audited, no
      // earlier version was archived, and the target carries no publishedAt.
      expect(store.audits).toHaveLength(0);
      expect(archivedIds(store.data)).toEqual([]);
      expect(onTarget(store.data).publishedAt).toBeNull();
    });
  }

  it("publishes the same draft from rows in any order and refuses the second attempt", async () => {
    const forward = fakeStore();
    const reverse = fakeStore((d) => d.entries.reverse());
    expect(await publish(reverse)).toEqual(await publish(forward));
    expect(forward.writes[0]?.expected.snapshotFingerprint).toBe(reverse.writes[0]?.expected.snapshotFingerprint);

    // Re-publishing the version the first call committed cannot succeed twice.
    expect(await publish(forward)).toEqual({ ok: false, kind: "NOT_DRAFT", versionId: TARGET, storedStatus: "PUBLISHED" });
    expect(forward.calls.filter((call) => call === "publishDraft")).toHaveLength(1);
    expect(forward.audits).toHaveLength(1);
  });

  it("reports every store failure as INTERNAL_ERROR without claiming a publication", async () => {
    const methods: (keyof DraftPublishStore)[] = ["findVersion", "listEntriesByVersion", "listTeachingsByIds",
      "listVenuesByIds", "listLecturerUnavailableByLecturerIds", "listVenueUnavailableByVenueIds",
      "listPublishedVersionsBySemester", "publishDraft"];
    for (const throwOn of methods) {
      const store = fakeStore(undefined, { throwOn });
      const result = await publish(store);
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      expect(JSON.stringify(result)).not.toContain("versionId");
      expect(store.calls).toContain(throwOn);
      expect(store.audits).toHaveLength(0);
    }
  });

  it("fails closed when the published-version read leaks another semester", async () => {
    const store = fakeStore();
    store.listPublishedVersionsBySemester = async () => [versionOf({ id: "ver-pub-s2", semester: 2, status: "PUBLISHED" })];
    expect(await publish(store)).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
    expect(store.calls).not.toContain("publishDraft");
  });

  it("keeps the fingerprint and any database detail out of every refusal", async () => {
    const store = fakeStore(undefined, { race: (d) => patch(d.venues, "v-1", { capacity: 5 }) });
    const result = JSON.stringify(await publish(store));
    expect(result).not.toContain(store.writes[0]?.expected.snapshotFingerprint ?? "§never§");
    expect(result).not.toMatch(/password|SELECT|sqlite|prisma|store down/i);
  });
});
