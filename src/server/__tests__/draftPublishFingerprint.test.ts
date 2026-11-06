/**
 * M4-T3a1 — the publication snapshot fingerprint on its own: deterministic,
 * order-independent between records, and unambiguous between fields. The
 * "legacy" helpers below reimplement the M4-T3a delimiter joining purely to
 * prove, with deliberately constructed fixtures, that distinct snapshots used
 * to encode identically; nothing shipped still uses them. The service itself
 * stays tested in `draftPublish.test.ts`, whose 38 tests are unchanged. The
 * M4-T3b1 error-logging regression (nothing derived from a caught exception
 * may reach `console.error`) lives in the last test below.
 */
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { DraftEntryRow, LecturerUnavailableRow, TeachingRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import { performDraftPublish } from "@/server/draftPublish";
import { publishSnapshotFingerprint, type DraftPublishStore, type PublishSnapshot, type PublishTransactionInput, type PublishVersionRow } from "@/server/draftPublishContract";

const officer: Actor = { id: "user-officer", role: "OFFICER", departmentId: null, studentGroupId: null };
const TARGET = "ver-draft-s1";
const CLOCK = new Date("2026-01-05T08:00:00.000Z");

const versionOf = (over: Partial<PublishVersionRow> = {}): PublishVersionRow => ({ id: TARGET, semester: 1, status: "DRAFT", publishedAt: null, ...over });
const entryOf = (id: string, over: Partial<DraftEntryRow> = {}): DraftEntryRow => ({ id, versionId: TARGET, teachingId: "t-a", venueId: "v-1", day: "MON", start: "08:00", end: "09:00", locked: false, ...over });
const teachingOf = (id: string, over: Partial<TeachingRow> = {}): TeachingRow => ({ id, lecturerId: "lect-A", groupId: "group-1", expectedSize: 40, unitCode: "CSI101", venueTypeRequired: "ROOM", ...over });
const venueOf = (id: string, over: Partial<VenueRow> = {}): VenueRow => ({ id, code: id === "v-1" ? "CR1" : "CR2", capacity: 60, type: "ROOM", ...over });
const lecturerBlocked = (id: string, over: Partial<LecturerUnavailableRow> = {}): LecturerUnavailableRow => ({ id, lecturerId: "lect-A", day: "FRI", start: "08:00", end: "09:00", available: false, ...over });
const venueClosed = (id: string, over: Partial<VenueUnavailableRow> = {}): VenueUnavailableRow => ({ id, venueId: "v-1", day: "FRI", start: "10:00", end: "11:00", reason: "exam", ...over });

/** A validation snapshot with every section populated and a row beside each one, so reordering is never a no-op. */
const base = (): PublishSnapshot => ({ version: versionOf(), entries: [entryOf("e-1"), entryOf("e-2", { teachingId: "t-b", venueId: "v-2", day: "TUE" })],
  teachings: [teachingOf("t-a"), teachingOf("t-b", { lecturerId: "lect-B", groupId: "group-2" })], venues: [venueOf("v-1"), venueOf("v-2")],
  lecturerUnavailable: [lecturerBlocked("la-1"), lecturerBlocked("la-2", { lecturerId: "lect-B", day: "THU" })],
  venueUnavailable: [venueClosed("vu-1"), venueClosed("vu-2", { venueId: "v-2", reason: null })], policy: DEFAULT_POLICY });

/** The M4-T3a record token: unescaped `|` between fields. */
const legacyRecord = (parts: readonly (string | number | boolean | null)[]): string => parts.map((part) => String(part ?? "")).join("|");
/** The M4-T3a section body: unescaped `;` between records (its length prefix is left out on purpose). */
const legacySection = (records: readonly string[]): string => [...records].sort().join(";");

const fp = (over: Partial<PublishSnapshot> = {}): string => publishSnapshotFingerprint({ ...base(), ...over });
const reverse = <T>(rows: readonly T[]): T[] => [...rows].reverse();

describe("order independence", () => {
  it("does not change when entries come back in another order", () => expect(fp({ entries: reverse(base().entries) })).toBe(fp()));
  it("does not change when teachings or venues come back in another order", () => {
    expect(fp({ teachings: reverse(base().teachings) })).toBe(fp()); expect(fp({ venues: reverse(base().venues) })).toBe(fp());
  });
  it("does not change when either unavailable-period set comes back in another order", () => {
    expect(fp({ lecturerUnavailable: reverse(base().lecturerUnavailable) })).toBe(fp()); expect(fp({ venueUnavailable: reverse(base().venueUnavailable) })).toBe(fp());
  });
});

describe("what the validation read", () => {
  it("changes when an entry's schedule changes", () => {
    expect(fp({ entries: [entryOf("e-1", { start: "09:00" }), base().entries[1]] })).not.toBe(fp());
    expect(fp({ entries: [entryOf("e-1", { end: "10:00" }), base().entries[1]] })).not.toBe(fp());
    expect(fp({ entries: [entryOf("e-1", { day: "WED" }), base().entries[1]] })).not.toBe(fp());
    expect(fp({ entries: [entryOf("e-1", { locked: true }), base().entries[1]] })).not.toBe(fp());
  });
  it("changes when a venue's capacity, code or type changes", () => {
    expect(fp({ venues: [venueOf("v-1", { capacity: 30 }), venueOf("v-2")] })).not.toBe(fp());
    expect(fp({ venues: [venueOf("v-1", { type: "LAB" }), venueOf("v-2")] })).not.toBe(fp());
    expect(fp({ venues: [venueOf("v-1", { code: "CR1A" }), venueOf("v-2")] })).not.toBe(fp());
  });
  it("changes when lecturer availability changes", () => {
    expect(fp({ lecturerUnavailable: [lecturerBlocked("la-1", { day: "MON" }), base().lecturerUnavailable[1]] })).not.toBe(fp());
    expect(fp({ lecturerUnavailable: [lecturerBlocked("la-1", { available: true }), base().lecturerUnavailable[1]] })).not.toBe(fp());
  });
  it("still covers every other field the old encoding covered", () => {
    expect(fp({ version: versionOf({ semester: 2 }) })).not.toBe(fp()); expect(fp({ version: versionOf({ status: "ARCHIVED" }) })).not.toBe(fp());
    expect(fp({ teachings: [teachingOf("t-a", { lecturerId: "lect-C" }), base().teachings[1]] })).not.toBe(fp());
    expect(fp({ teachings: [teachingOf("t-a", { expectedSize: 120 }), base().teachings[1]] })).not.toBe(fp());
    expect(fp({ venueUnavailable: [venueClosed("vu-1", { reason: "sports" }), base().venueUnavailable[1]] })).not.toBe(fp());
    expect(fp({ policy: { ...DEFAULT_POLICY, slotEnd: "16:00" } })).not.toBe(fp()); expect(fp({ policy: { ...DEFAULT_POLICY, maxClassesPerGroupPerDay: 1 } })).not.toBe(fp());
  });
});

describe("unambiguous field and record boundaries", () => {
  it("cannot let a stored | move text into the next field", () => {
    const left = [teachingOf("t-a", { unitCode: "CSI|LAB", venueTypeRequired: "ROOM" }), base().teachings[1]];
    const right = [teachingOf("t-a", { unitCode: "CSI", venueTypeRequired: "LAB|ROOM" }), base().teachings[1]];
    expect(legacyRecord(["t-a", left[0].unitCode, left[0].venueTypeRequired])).toBe(legacyRecord(["t-a", right[0].unitCode, right[0].venueTypeRequired]));
    expect(fp({ teachings: left })).not.toBe(fp({ teachings: right }));
  });
  it("cannot let a stored ; imitate a record boundary", () => {
    const venueRecord = (row: VenueRow) => legacyRecord([row.id, row.code, row.capacity, row.type]);
    const two = [venueOf("v-1"), venueOf("v-2", { capacity: 50, type: "LAB" })], shifted = [venueOf("v-1", { type: "ROOM;v-2|CR2|50|LAB" })];
    const folded = [venueOf("v-1", { type: "ROOM" })];
    expect(legacySection(two.map(venueRecord))).toBe(legacySection(shifted.map(venueRecord)));
    expect(fp({ venues: shifted })).not.toBe(fp({ venues: two }));
    expect(fp({ venues: folded })).not.toBe(fp({ venues: two }));
  });
  it("encodes a null, an empty string and a value as three different things", () => {
    const withReason = (reason: string | null): VenueUnavailableRow[] => [venueClosed("vu-1", { reason }), venueClosed("vu-2", { venueId: "v-2", reason: null })];
    const legacyReasonOf = (reason: string | null) => legacyRecord(["vu-1", "FRI", "10:00", "11:00", reason ?? ""]);
    expect(legacyReasonOf(venueClosed("vu-1", { reason: null }).reason)).toBe(legacyReasonOf(venueClosed("vu-1", { reason: "" }).reason));
    expect(fp({ venueUnavailable: withReason(null) })).not.toBe(fp({ venueUnavailable: withReason("") })); expect(fp({ venueUnavailable: withReason("") })).not.toBe(fp({ venueUnavailable: withReason("exam") }));
    expect(fp({ version: versionOf({ publishedAt: CLOCK }) })).not.toBe(fp()); expect(fp({ venueUnavailable: [] })).not.toBe(fp());
  });
  it("is deterministic: equal snapshots encode byte-identically", () => {
    expect(publishSnapshotFingerprint(base())).toBe(publishSnapshotFingerprint(base()));
    expect(publishSnapshotFingerprint(structuredClone(base()))).toBe(publishSnapshotFingerprint(base())); expect(JSON.parse(fp())).toBeInstanceOf(Array);
  });
});

// --- the service, on a store that recomputes the fingerprint at commit ------

const byIds = <T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] => rows.filter((row) => ids.includes(row.id));
/** The two availability sections are looked up by their owner, not by their own id. */
const byLecturer = (rows: readonly LecturerUnavailableRow[], ids: readonly string[]): LecturerUnavailableRow[] => rows.filter((row) => ids.includes(row.lecturerId));
const byClosedVenue = (rows: readonly VenueUnavailableRow[], ids: readonly string[]): VenueUnavailableRow[] => rows.filter((row) => ids.includes(row.venueId));

/** The service's own reads, plus a commit that re-derives the fingerprint from data a competing write changed after them. */
function storeOf(state: PublishSnapshot, race: (committed: PublishSnapshot) => void): DraftPublishStore {
  return {
    findVersion: async (id) => (state.version.id === id ? state.version : null),
    listEntriesByVersion: async (versionId) => state.entries.filter((row) => row.versionId === versionId),
    listTeachingsByIds: async (ids) => byIds(state.teachings, ids),
    listVenuesByIds: async (ids) => byIds(state.venues, ids),
    listLecturerUnavailableByLecturerIds: async (ids) => byLecturer(state.lecturerUnavailable, ids),
    listVenueUnavailableByVenueIds: async (ids) => byClosedVenue(state.venueUnavailable, ids),
    listPublishedVersionsBySemester: async () => [],
    publishDraft: async (input: PublishTransactionInput) => {
      const committed: PublishSnapshot = { ...state };
      race(committed);
      return publishSnapshotFingerprint(committed) === input.expected.snapshotFingerprint
        ? { ok: true, archivedVersionIds: [] }
        : { stale: true, reason: "SNAPSHOT_CHANGED" };
    },
  };
}

const publishWith = async (race: (committed: PublishSnapshot) => void) => performDraftPublish(storeOf(base(), race), officer, { versionId: TARGET }, DEFAULT_POLICY, () => CLOCK);

describe("the publication service on top of the corrected encoding", () => {
  it("still refuses a validation snapshot that changed before the commit", async () => {
    expect(await publishWith(() => undefined)).toEqual({ ok: true, versionId: TARGET, semester: 1, archivedVersionIds: [], publishedAt: CLOCK });
    const venueChanged = (next: PublishSnapshot) => { next.venues = [venueOf("v-1", { capacity: 20 }), venueOf("v-2")]; };
    expect(await publishWith(venueChanged)).toEqual({ ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" });
    expect(await publishWith((next) => { next.entries = [entryOf("e-1", { venueId: "v-2" }), base().entries[1]]; })).toEqual({ ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" });
    expect(await publishWith((next) => { next.venueUnavailable = [venueClosed("vu-1", { reason: null }), base().venueUnavailable[1]]; })).toEqual({ ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" });
  });
  it("keeps the fingerprint and any database detail out of the client-facing result and the server log", async () => {
    const secret = "postgres://tams:hunter2@db.internal:5432/tams", printed = publishSnapshotFingerprint(base());
    const sql = `update "TimetableVersion" set status='PUBLISHED'`;
    // M4-T3b1: the injected failure carries recognizable fake credentials, SQL
    // and the fingerprint; none of them may reach the log either, only the
    // fixed operational line. The spy is restored in `finally` so a failed
    // assertion cannot leak mocking into the tests after this one.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await publishWith(() => { throw new Error(`${sql} — ${printed} — ${secret}`); });
      const logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(result).toEqual({ ok: false, kind: "INTERNAL_ERROR" });
      const wire = JSON.stringify(result);
      expect(wire).not.toContain(printed); expect(wire).not.toContain("hunter2"); expect(wire).not.toContain("TimetableVersion");
      expect(logged).not.toContain(printed); expect(logged).not.toContain("hunter2"); expect(logged).not.toContain(secret);
      expect(logged).not.toContain(sql); expect(logged).not.toContain("TimetableVersion");
      expect(logged).not.toContain("Error"); expect(logged).not.toContain("at ");
      expect(logged).toBe("[draftPublish] publication failed; returning INTERNAL_ERROR");
      const staleWire = JSON.stringify(await publishWith((next) => { next.venues = [venueOf("v-1", { code: "CR9" }), venueOf("v-2")]; }));
      expect(staleWire).not.toContain(printed);
    } finally {
      spy.mockRestore();
    }
  });
});
