import { describe, expect, it } from "vitest";
import type { Actor } from "../../domain/permissions";
import {
  createLecturerAvailabilityStore,
  loadAllLecturerAvailability,
  loadLecturerAvailability,
  performAddUnavailablePeriod,
  performRemoveUnavailablePeriod,
  type AddUnavailableResult,
  type LecturerAvailabilityRecord,
  type LecturerAvailabilityStore,
  type LoadAvailabilityResult,
  type RemoveAvailabilityResult,
} from "../lecturerAvailability";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function actorWith(id: string, role: Actor["role"], departmentId: string | null = "dept-computing"): Actor {
  return { id, role, departmentId, studentGroupId: null };
}

const lecturerA = actorWith("user-lecturer-a", "LECTURER");
const lecturerB = actorWith("user-lecturer-b", "LECTURER", "dept-maths");
const officer = actorWith("user-officer", "OFFICER", null);
const admin = actorWith("user-admin", "ADMIN", null);
const deptRep = actorWith("user-deptrep", "DEPT_REP");
const approver = actorWith("user-approver", "APPROVER");
const student = actorWith("user-student", "STUDENT", null);

class FakeLecturerAvailabilityStore implements LecturerAvailabilityStore {
  profiles = new Map<string, { lecturerId: string; lecturerUserId: string }>();
  records = new Map<string, LecturerAvailabilityRecord>();
  createCalls: Array<{ lecturerId: string; period: unknown; available: false }> = [];
  deleteCalls: string[] = [];
  /** Counts every store method call so tests can prove denied reads never query. */
  queryCount = 0;
  private nextId = 1;

  addProfile(userId: string, lecturerId: string): void {
    this.profiles.set(userId, { lecturerId, lecturerUserId: userId });
  }

  addPeriod(
    lecturerId: string,
    lecturerUserId: string,
    period: { day: string; start: string; end: string },
    available = false,
  ): string {
    const id = `av-${this.nextId++}`;
    this.records.set(id, { id, lecturerId, lecturerUserId, day: period.day, start: period.start, end: period.end, available });
    return id;
  }

  async findLecturerByUserId(userId: string) {
    this.queryCount++;
    return this.profiles.get(userId) ?? null;
  }

  async findRecord(availabilityId: string) {
    this.queryCount++;
    return this.records.get(availabilityId) ?? null;
  }

  async listUnavailableRecordsByLecturerId(lecturerId: string) {
    this.queryCount++;
    return [...this.records.values()].filter((r) => r.lecturerId === lecturerId);
  }

  async listAllUnavailableRecords() {
    this.queryCount++;
    return [...this.records.values()];
  }

  async createUnavailablePeriod(lecturerId: string, period: { day: string; start: string; end: string }) {
    this.queryCount++;
    const id = `av-${this.nextId++}`;
    this.records.set(id, { id, lecturerId, lecturerUserId: "pending", ...period, available: false });
    this.createCalls.push({ lecturerId, period, available: false });
    return { id };
  }

  async deleteRecord(availabilityId: string) {
    this.queryCount++;
    this.records.delete(availabilityId);
    this.deleteCalls.push(availabilityId);
  }
}

function storeWithTwoLecturers(): FakeLecturerAvailabilityStore {
  const store = new FakeLecturerAvailabilityStore();
  store.addProfile("user-lecturer-a", "lect-a");
  store.addProfile("user-lecturer-b", "lect-b");
  return store;
}

const monAfternoon = { day: "MON", start: "13:00", end: "14:00" };

/** Narrowing helpers: fail the test when the result is not the expected variant. */
function expectAdded(result: AddUnavailableResult): { period: { id: string } } {
  if (!result.ok) throw new Error(`expected ok add, got ${result.kind}`);
  return result;
}

function expectFailure(result: AddUnavailableResult | RemoveAvailabilityResult | LoadAvailabilityResult) {
  if (result.ok) throw new Error("expected failure, got ok");
  return result as { kind: string; message?: string; errors?: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("lecturer availability authentication", () => {
  it("rejects an unauthenticated add", async () => {
    const store = storeWithTwoLecturers();
    const result = await performAddUnavailablePeriod(store, null, monAfternoon);
    expect(expectFailure(result).kind).toBe("UNAUTHENTICATED");
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects an unauthenticated remove", async () => {
    const store = storeWithTwoLecturers();
    const id = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const result = await performRemoveUnavailablePeriod(store, null, id);
    expect(expectFailure(result).kind).toBe("UNAUTHENTICATED");
    expect(store.deleteCalls).toHaveLength(0);
    expect(store.records.has(id)).toBe(true);
  });

  it("rejects unauthenticated reads", async () => {
    const store = storeWithTwoLecturers();
    const own = await loadLecturerAvailability(store, null, "user-lecturer-a");
    expect(expectFailure(own).kind).toBe("UNAUTHENTICATED");
    const all = await loadAllLecturerAvailability(store, null);
    expect(expectFailure(all).kind).toBe("UNAUTHENTICATED");
  });
});

// ---------------------------------------------------------------------------
// Authorization — only lecturers may write
// ---------------------------------------------------------------------------

describe("lecturer availability authorization", () => {
  it.each([
    ["OFFICER", officer],
    ["ADMIN", admin],
    ["DEPT_REP", deptRep],
    ["APPROVER", approver],
    ["STUDENT", student],
  ])("%s cannot add a period", async (_role, actor) => {
    const store = storeWithTwoLecturers();
    const result = await performAddUnavailablePeriod(store, actor, monAfternoon);
    expect(expectFailure(result).kind).toBe("FORBIDDEN");
    expect(store.createCalls).toHaveLength(0);
  });

  it.each([
    ["OFFICER", officer],
    ["ADMIN", admin],
    ["DEPT_REP", deptRep],
    ["APPROVER", approver],
    ["STUDENT", student],
  ])("%s cannot remove a period", async (_role, actor) => {
    const store = storeWithTwoLecturers();
    const id = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const result = await performRemoveUnavailablePeriod(store, actor, id);
    expect(expectFailure(result).kind).toBe("FORBIDDEN");
    expect(store.deleteCalls).toHaveLength(0);
    expect(store.records.has(id)).toBe(true);
  });

  it("lets a lecturer add their own period", async () => {
    const store = storeWithTwoLecturers();
    const result = await performAddUnavailablePeriod(store, lecturerA, monAfternoon);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("lecturer availability ownership", () => {
  it("stops a lecturer from removing another lecturer's record", async () => {
    const store = storeWithTwoLecturers();
    const id = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const result = await performRemoveUnavailablePeriod(store, lecturerB, id);
    expect(expectFailure(result).kind).toBe("FORBIDDEN");
    expect(store.deleteCalls).toHaveLength(0);
    expect(store.records.has(id)).toBe(true);
  });

  it("keeps a lecturer's add on their own profile even when another lecturer exists", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-b", "user-lecturer-b", { day: "MON", start: "09:00", end: "10:00" });
    expectAdded(await performAddUnavailablePeriod(store, lecturerA, monAfternoon));
    expect(store.createCalls[0]?.lecturerId).toBe("lect-a");
    // lecturer B's untouched row is still there
    expect(store.records.size).toBe(2);
  });

  it("removes only the targeted record", async () => {
    const store = storeWithTwoLecturers();
    const keep = store.addPeriod("lect-a", "user-lecturer-a", { day: "TUE", start: "10:00", end: "11:00" });
    const remove = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const other = store.addPeriod("lect-b", "user-lecturer-b", { day: "MON", start: "09:00", end: "10:00" });
    const result = await performRemoveUnavailablePeriod(store, lecturerA, remove);
    expect(result.ok).toBe(true);
    expect(store.deleteCalls).toEqual([remove]);
    expect(store.records.has(keep)).toBe(true);
    expect(store.records.has(other)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Identity protection — browser input is never authority
// ---------------------------------------------------------------------------

describe("lecturer availability identity protection", () => {
  it("ignores forged lecturerId/userId fields in the add input", async () => {
    const store = storeWithTwoLecturers();
    const result = await performAddUnavailablePeriod(store, lecturerA, {
      ...monAfternoon,
      lecturerId: "lect-b",
      userId: "user-lecturer-b",
      role: "ADMIN",
    });
    expectAdded(result);
    expect(store.createCalls[0]?.lecturerId).toBe("lect-a");
  });

  it("does not redirect ownership when the input names another lecturer's conflicting period", async () => {
    const store = storeWithTwoLecturers();
    // The conflict check only ever sees the caller's own periods, so lecturer B's
    // MON 13:00-14:00 cannot block lecturer A from saving the same slot.
    store.addPeriod("lect-b", "user-lecturer-b", monAfternoon);
    const result = await performAddUnavailablePeriod(store, lecturerA, monAfternoon);
    expectAdded(result);
    expect(store.createCalls[0]?.lecturerId).toBe("lect-a");
  });

  it("resolves the profile from the actor id, not from a subject in the input", async () => {
    const store = new FakeLecturerAvailabilityStore();
    store.addProfile("user-lecturer-a", "lect-a");
    const result = await performAddUnavailablePeriod(store, lecturerA, {
      ...monAfternoon,
      subjectUserId: "user-does-not-exist",
    });
    expectAdded(result);
    expect(store.profiles.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Missing lecturer profile
// ---------------------------------------------------------------------------

describe("lecturer availability profile resolution", () => {
  it("handles a LECTURER user without a Lecturer profile safely", async () => {
    const store = new FakeLecturerAvailabilityStore();
    const orphan = actorWith("user-no-profile", "LECTURER");
    const result = await performAddUnavailablePeriod(store, orphan, monAfternoon);
    expect(expectFailure(result).kind).toBe("NO_LECTURER_PROFILE");
    expect(store.createCalls).toHaveLength(0);
  });

  it("removal of a missing record reports NOT_FOUND without deleting", async () => {
    const store = storeWithTwoLecturers();
    const result = await performRemoveUnavailablePeriod(store, lecturerA, "av-missing");
    expect(expectFailure(result).kind).toBe("NOT_FOUND");
    expect(store.deleteCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Validation and interval rules
// ---------------------------------------------------------------------------

describe("lecturer availability validation", () => {
  it("rejects a malformed time without writing", async () => {
    const store = storeWithTwoLecturers();
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "25:00", end: "26:00" }));
    expect(result.kind).toBe("INVALID");
    expect(result.errors?.start).toBeDefined();
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects an unknown day", async () => {
    const store = storeWithTwoLecturers();
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "SAT", start: "13:00", end: "14:00" }));
    expect(result.kind).toBe("INVALID");
    expect(result.errors?.day).toBeDefined();
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects missing fields", async () => {
    const store = storeWithTwoLecturers();
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON" }));
    expect(result.kind).toBe("INVALID");
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects a reversed interval", async () => {
    const store = storeWithTwoLecturers();
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "14:00", end: "13:00" }));
    expect(result.kind).toBe("INVALID");
    expect(result.errors?.end).toBe("Start must be earlier than end");
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects a zero-length interval", async () => {
    const store = storeWithTwoLecturers();
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "13:00", end: "13:00" }));
    expect(result.kind).toBe("INVALID");
    expect(store.createCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Duplicate / overlap / adjacent
// ---------------------------------------------------------------------------

describe("lecturer availability conflict rules", () => {
  it("rejects a duplicate of a stored period and names it", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, monAfternoon));
    expect(result.kind).toBe("DUPLICATE");
    expect(result.message).toContain("Monday 13:00-14:00");
    expect(store.createCalls).toHaveLength(0);
  });

  it("rejects an overlapping period", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const result = expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "13:30", end: "14:30" }));
    expect(result.kind).toBe("OVERLAP");
    expect(store.createCalls).toHaveLength(0);
  });

  it("accepts an adjacent period", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", { day: "MON", start: "12:00", end: "13:00" });
    expectAdded(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "13:00", end: "14:00" }));
    expect(store.createCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Persistence shape
// ---------------------------------------------------------------------------

describe("lecturer availability persistence", () => {
  it("stores a valid period as available: false on the caller's profile", async () => {
    const store = storeWithTwoLecturers();
    const { period } = expectAdded(await performAddUnavailablePeriod(store, lecturerA, monAfternoon));
    expect(store.createCalls).toEqual([
      { lecturerId: "lect-a", period: { day: "MON", start: "13:00", end: "14:00" }, available: false },
    ]);
    const record = store.records.get(period.id);
    expect(record?.available).toBe(false);
    expect(record?.lecturerId).toBe("lect-a");
  });
});

// ---------------------------------------------------------------------------
// Data protection — invalid operations never change existing records
// ---------------------------------------------------------------------------

describe("lecturer availability data protection", () => {
  it("leaves stored records unchanged after invalid, duplicate, forbidden and missing-id operations", async () => {
    const store = storeWithTwoLecturers();
    const kept = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const snapshotBefore = JSON.stringify([...store.records.entries()]);

    expectFailure(await performAddUnavailablePeriod(store, lecturerA, { day: "MON", start: "bad", end: "14:00" }));
    expectFailure(await performAddUnavailablePeriod(store, lecturerA, monAfternoon));
    expectFailure(await performAddUnavailablePeriod(store, officer, { day: "TUE", start: "09:00", end: "10:00" }));
    expectFailure(await performRemoveUnavailablePeriod(store, lecturerA, "av-missing"));
    expectFailure(await performRemoveUnavailablePeriod(store, admin, kept));

    expect(JSON.stringify([...store.records.entries()])).toBe(snapshotBefore);
    expect(store.deleteCalls).toHaveLength(0);
    expect(store.createCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Read permissions
// ---------------------------------------------------------------------------

describe("lecturer availability reads", () => {
  it("let officers and admins read any lecturer's availability", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    for (const actor of [officer, admin]) {
      const result = await loadLecturerAvailability(store, actor, "user-lecturer-a");
      if (!result.ok) throw new Error("expected ok read");
      expect(result.views).toEqual([
        {
          lecturerId: "lect-a",
          periods: [{ id: "av-1", day: "MON", start: "13:00", end: "14:00" }],
        },
      ]);
    }
  });

  it("lets a lecturer read their own periods and blocks another lecturer's", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const own = await loadLecturerAvailability(store, lecturerA, "user-lecturer-a");
    if (!own.ok) throw new Error("expected ok read");
    expect(own.views[0]?.periods).toHaveLength(1);

    expect(expectFailure(await loadLecturerAvailability(store, lecturerA, "user-lecturer-b")).kind).toBe("FORBIDDEN");
  });

  it.each([
    ["DEPT_REP", deptRep],
    ["APPROVER", approver],
    ["STUDENT", student],
  ])("blocks %s from reading availability", async (_role, actor) => {
    const store = storeWithTwoLecturers();
    expect(expectFailure(await loadLecturerAvailability(store, actor, "user-lecturer-a")).kind).toBe("FORBIDDEN");
  });

  it("denies a nonexistent subject for unauthorized roles without querying the store", async () => {
    // Regression: the VIEW permission must be decided before the profile
    // lookup, otherwise an empty success vs FORBIDDEN tells an attacker
    // whether a user id belongs to a lecturer (existence oracle).
    const store = storeWithTwoLecturers();
    for (const actor of [lecturerB, deptRep, approver, student]) {
      const result = await loadLecturerAvailability(store, actor, "user-does-not-exist");
      expect(expectFailure(result).kind).toBe("FORBIDDEN");
    }
    expect(store.queryCount).toBe(0);
  });

  it("answers a lecturer's read of their own unknown subject identically to a known one", async () => {
    // SELF holders pass the permission either way; the store then reports
    // "no profile", never a leak, and never FORBIDDEN-by-existence.
    const store = new FakeLecturerAvailabilityStore();
    store.addProfile("user-lecturer-a", "lect-a");
    const orphan = actorWith("user-lecturer-orphan", "LECTURER");
    const missing = await loadLecturerAvailability(store, orphan, orphan.id);
    if (!missing.ok) throw new Error("expected ok read");
    expect(missing.views).toEqual([]);
  });

  it("returns an empty view list for an unknown subject instead of leaking", async () => {
    const store = storeWithTwoLecturers();
    const result = await loadLecturerAvailability(store, officer, "user-not-a-lecturer");
    if (!result.ok) throw new Error("expected ok read");
    expect(result.views).toEqual([]);
  });

  it("excludes personal data and drops rows that are not unavailable", async () => {
    const store = storeWithTwoLecturers();
    store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    store.addPeriod("lect-a", "user-lecturer-a", { day: "FRI", start: "09:00", end: "10:00" }, true);
    const result = await loadLecturerAvailability(store, lecturerA, "user-lecturer-a");
    if (!result.ok) throw new Error("expected ok read");
    expect(result.views[0]?.periods).toHaveLength(1);
    // The view is the minimal agreed shape: lecturerId + periods, no user ids,
    // no emails, no password fields.
    expect(Object.keys(result.views[0] ?? {})).toEqual(["lecturerId", "periods"]);
    expect(Object.keys(result.views[0]?.periods[0] ?? {})).toEqual(["id", "day", "start", "end"]);
    expect(JSON.stringify(result.views)).not.toMatch(/email|password|lecturerUserId/i);
  });

  it("gives M3 the lecturer-grouped shape from load-all", async () => {
    const store = storeWithTwoLecturers();
    const a1 = store.addPeriod("lect-a", "user-lecturer-a", monAfternoon);
    const a2 = store.addPeriod("lect-a", "user-lecturer-a", { day: "TUE", start: "09:00", end: "10:00" });
    const b1 = store.addPeriod("lect-b", "user-lecturer-b", { day: "WED", start: "11:00", end: "12:00" });

    for (const actor of [officer, admin]) {
      const result = await loadAllLecturerAvailability(store, actor);
      if (!result.ok) throw new Error("expected ok read");
      expect(result.views).toEqual([
        {
          lecturerId: "lect-a",
          periods: [
            { id: a1, day: "MON", start: "13:00", end: "14:00" },
            { id: a2, day: "TUE", start: "09:00", end: "10:00" },
          ],
        },
        {
          lecturerId: "lect-b",
          periods: [{ id: b1, day: "WED", start: "11:00", end: "12:00" }],
        },
      ]);
    }
  });

  it.each([
    ["LECTURER", lecturerA],
    ["DEPT_REP", deptRep],
    ["APPROVER", approver],
    ["STUDENT", student],
  ])("blocks %s from the load-all view", async (_role, actor) => {
    const store = storeWithTwoLecturers();
    expect(expectFailure(await loadAllLecturerAvailability(store, actor)).kind).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Store wiring sanity (Prisma implementation is exercised by typecheck/build)
// ---------------------------------------------------------------------------

describe("lecturer availability store factory", () => {
  it("creates the Prisma-backed store with the full interface", () => {
    const store = createLecturerAvailabilityStore();
    expect(typeof store.findLecturerByUserId).toBe("function");
    expect(typeof store.findRecord).toBe("function");
    expect(typeof store.listUnavailableRecordsByLecturerId).toBe("function");
    expect(typeof store.listAllUnavailableRecords).toBe("function");
    expect(typeof store.createUnavailablePeriod).toBe("function");
    expect(typeof store.deleteRecord).toBe("function");
  });
});
