import { describe, it, expect } from "vitest";
import { performVenueWrite } from "../venueWrite";
import type { VenueStore, StoredVenue, StoredVenueFields, AuditDraft } from "../venueWrite";
import type { Actor } from "../../domain/permissions";
import { SHARED_OWNER_VALUE } from "../../domain/venueForm";
import type { VenueFormRaw } from "../../domain/venueForm";
import { seedVenues, seedDepartments } from "../../domain/seedData";
import { serializeJsonFacilities } from "../../domain/types";

function actor(
  id: string,
  role: Actor["role"],
  departmentId: string | null = null,
  studentGroupId: string | null = null,
): Actor {
  return { id, role, departmentId, studentGroupId };
}

const officer = actor("user-officer", "OFFICER");
const computingRep = actor("user-deptrep-computing", "DEPT_REP", "dept-computing");
const mathsRep = actor("user-deptrep-maths", "DEPT_REP", "dept-mathematics");
const nullDeptRep = actor("user-nullrep", "DEPT_REP", null);
const approver = actor("user-approver-computing", "APPROVER", "dept-computing");
const lecturer = actor("user-lecturer-a", "LECTURER", "dept-computing");
const student = actor("user-student-1", "STUDENT", "dept-computing", "group-SE-Y4");
const admin = actor("user-admin", "ADMIN");

class FakeStore implements VenueStore {
  venues = new Map<string, StoredVenue>();
  departments = new Set<string>();
  createCalls: { fields: StoredVenueFields; audit: AuditDraft }[] = [];
  updateCalls: { id: string; fields: StoredVenueFields; audit: AuditDraft }[] = [];
  auditDrafts: AuditDraft[] = [];
  forceConflictCreate = false;
  forceConflictUpdate = false;
  forceNotFoundUpdate = false;

  constructor() {
    for (const d of seedDepartments) this.departments.add(d.id);
    for (const v of seedVenues) {
      this.venues.set(v.id, {
        id: v.id,
        code: v.code,
        type: v.type,
        capacity: v.capacity,
        ownerDepartmentId: v.ownerDepartmentId,
        facilities: serializeJsonFacilities(v.facilities),
        status: v.status,
      });
    }
  }

  async findVenue(id: string) { return this.venues.get(id) ?? null; }
  async findVenueByCode(code: string) {
    for (const v of this.venues.values()) if (v.code === code) return { id: v.id };
    return null;
  }
  async departmentExists(id: string) { return this.departments.has(id); }
  async createVenue(fields: StoredVenueFields, audit: AuditDraft) {
    this.createCalls.push({ fields, audit });
    this.auditDrafts.push(audit);
    if (this.forceConflictCreate) return { conflict: true } as const;
    const id = "venue-new-" + (this.venues.size + 1);
    this.venues.set(id, { id, ...fields });
    return { id };
  }
  async updateVenue(id: string, fields: StoredVenueFields, audit: AuditDraft) {
    this.updateCalls.push({ id, fields, audit });
    this.auditDrafts.push(audit);
    if (this.forceConflictUpdate) return { conflict: true } as const;
    if (this.forceNotFoundUpdate) return { notFound: true } as const;
    const existing = this.venues.get(id);
    if (!existing) return { notFound: true } as const;
    this.venues.set(id, { id, ...fields });
    return { ok: true } as const;
  }
}

const validRaw: VenueFormRaw = {
  code: "NEW1",
  type: "ROOM",
  capacity: "40",
  facilities: ["projector"],
  status: "ACTIVE",
  owner: "dept-computing",
};

describe("performVenueWrite", () => {
  it("V1: null actor with a valid form -> UNAUTHENTICATED", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, null, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V7: officer creates a shared venue", async () => {
    const store = new FakeStore();
    const raw = { ...validRaw, owner: SHARED_OWNER_VALUE };
    const r = await performVenueWrite(store, officer, { op: "CREATE", raw });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(true);
      const v = await store.findVenue(r.venueId);
      expect(v?.code).toBe("NEW1");
      expect(v?.ownerDepartmentId).toBeNull();
      expect(v?.facilities).toBe('["projector"]');
    }
    expect(store.auditDrafts[0]).toEqual({ actorId: "user-officer", action: "VENUE_CREATE", reason: "created" });
  });

  it("V13: officer submits capacity abc and no owner -> VALIDATION both capacity and owner", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "CREATE",
      raw: { code: "NEW1", type: "ROOM", capacity: "abc", facilities: [] },
    });
    expect(r).toEqual({
      ok: false,
      kind: "VALIDATION",
      errors: {
        capacity: "Capacity must be a whole number from 1 to 1000",
        owner: "Choose an owner or Shared",
      },
    });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V15: create with code CR1 -> VALIDATION duplicate code", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, { op: "CREATE", raw: { ...validRaw, code: "CR1" } });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { code: "A venue with this code already exists" } });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V21: Computing rep edits venue-CR1 capacity to 70", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: true });
    const v = await store.findVenue("venue-CR1");
    expect(v?.capacity).toBe(70);
    const last = store.auditDrafts[store.auditDrafts.length - 1];
    expect(last).toEqual({ actorId: "user-deptrep-computing", action: "VENUE_EDIT", reason: "changed: capacity" });
  });

  it("V29: identical edit returns changed false without an update call", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, { op: "EDIT", venueId: "venue-CR1", raw: { code: "CR1", type: "ROOM", capacity: "60", facilities: [], status: "ACTIVE", owner: "dept-computing" } });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: false });
    expect(store.updateCalls).toHaveLength(0);
    expect(store.createCalls).toHaveLength(0);
  });

  it("V2: student with a valid form -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, student, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V3: lecturer with a valid form -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, lecturer, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V4: approver with a valid form -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, approver, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V5: admin with a valid form -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, admin, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it.each([
    ["student", student],
    ["lecturer", lecturer],
    ["approver", approver],
    ["admin", admin],
  ] as const)("V6: %s with an invalid form is FORBIDDEN without validation errors", async (_, actorWithNoAccess) => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, actorWithNoAccess, {
      op: "CREATE",
      raw: { code: "NEW1", type: "ROOM", capacity: "abc" },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V8: officer creates a venue owned by dept-mathematics", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "CREATE",
      raw: { ...validRaw, owner: "dept-mathematics" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const stored = await store.findVenue(r.venueId);
      expect(stored?.ownerDepartmentId).toBe("dept-mathematics");
    }
    expect(store.auditDrafts[0]).toEqual({
      actorId: "user-officer",
      action: "VENUE_CREATE",
      reason: "created",
    });
  });

  it("V9: Computing rep creates a venue owned by dept-computing", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "CREATE",
      raw: { ...validRaw, code: "NEW2" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const stored = await store.findVenue(r.venueId);
      expect(stored?.ownerDepartmentId).toBe("dept-computing");
    }
    expect(store.auditDrafts[0]?.actorId).toBe("user-deptrep-computing");
  });

  it("V10: Computing rep creates a venue owned by dept-mathematics -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "CREATE",
      raw: { ...validRaw, owner: "dept-mathematics" },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V11: Computing rep creates a shared venue -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "CREATE",
      raw: { ...validRaw, owner: SHARED_OWNER_VALUE },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V12: dept rep with departmentId null creates a venue -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, nullDeptRep, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V14: officer creates with owner dept-unknown -> VALIDATION { owner: Unknown department }", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "CREATE",
      raw: { ...validRaw, owner: "dept-unknown" },
    });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { owner: "Unknown department" } });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V16: edit venue-CR2 changing its code to CR1 -> same code error", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR2",
      raw: { code: "CR1", type: "ROOM", capacity: "50", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { code: "A venue with this code already exists" } });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V17: edit venue-CR1 keeping code CR1 and changing capacity -> ok", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: true });
    expect(store.updateCalls).toHaveLength(1);
    expect(store.createCalls).toHaveLength(0);
  });

  // Forced store failures intentionally attempt one write; V18/V19/V31 assert the other method is untouched.
  it("V18: store conflict on create -> duplicate-code VALIDATION and nothing persisted", async () => {
    const store = new FakeStore();
    store.forceConflictCreate = true;
    const venueCountBefore = store.venues.size;
    const r = await performVenueWrite(store, officer, { op: "CREATE", raw: validRaw });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { code: "A venue with this code already exists" } });
    expect(store.createCalls).toHaveLength(1);
    expect(store.updateCalls).toHaveLength(0);
    expect(store.venues.size).toBe(venueCountBefore);
    expect(await store.findVenueByCode("NEW1")).toBeNull();
  });

  // Forced store failures intentionally attempt one write; V18/V19/V31 assert the other method is untouched.
  it("V19: store conflict on update -> duplicate-code VALIDATION and unchanged venue", async () => {
    const store = new FakeStore();
    store.forceConflictUpdate = true;
    const before = { ...store.venues.get("venue-CR1")! };
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { code: "A venue with this code already exists" } });
    expect(store.updateCalls).toHaveLength(1);
    expect(store.createCalls).toHaveLength(0);
    expect(store.venues.get("venue-CR1")).toEqual(before);
  });

  it("V20: officer edits an id that does not exist -> NOT_FOUND", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "EDIT",
      venueId: "venue-missing",
      raw: validRaw,
    });
    expect(r).toEqual({ ok: false, kind: "NOT_FOUND" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V22: Computing rep edits Mathematics venue-CR3 claiming Computing ownership -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR3",
      raw: { code: "CR3", type: "ROOM", capacity: "40", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V23: Computing rep edits shared venue-GR1 -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-GR1",
      raw: { code: "GR1", type: "ROOM", capacity: "80", facilities: [], status: "ACTIVE", owner: SHARED_OWNER_VALUE },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V24: Computing rep proposes Mathematics ownership for own venue-CR1 -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "60", facilities: [], status: "ACTIVE", owner: "dept-mathematics" },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V25: Computing rep proposes shared ownership for own venue-CR1 -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "60", facilities: [], status: "ACTIVE", owner: SHARED_OWNER_VALUE },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V26: Mathematics rep edits venue-LH2 -> ok", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, mathsRep, {
      op: "EDIT",
      venueId: "venue-LH2",
      raw: { code: "LH2", type: "HALL", capacity: "110", facilities: ["projector"], status: "ACTIVE", owner: "dept-mathematics" },
    });
    expect(r).toEqual({ ok: true, venueId: "venue-LH2", changed: true });
    const stored = await store.findVenue("venue-LH2");
    expect(stored?.capacity).toBe(110);
    expect(store.auditDrafts[store.auditDrafts.length - 1]?.reason).toBe(
      "changed: capacity",
    );
  });

  it("V27: Mathematics rep edits venue-CR1 -> FORBIDDEN", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, mathsRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "60", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: false, kind: "FORBIDDEN" });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
  });

  it("V28: officer changes venue-GR1 owner to dept-computing", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "EDIT",
      venueId: "venue-GR1",
      raw: { code: "GR1", type: "ROOM", capacity: "80", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: true, venueId: "venue-GR1", changed: true });
    expect(store.auditDrafts[store.auditDrafts.length - 1]).toEqual({
      actorId: "user-officer",
      action: "VENUE_EDIT",
      reason: "changed: owner",
    });
  });

  it("V30: edit changing type, capacity and status records the exact audit reason", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "LAB", capacity: "70", facilities: [], status: "INACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: true });
    expect(store.auditDrafts[store.auditDrafts.length - 1]).toEqual({
      actorId: "user-officer",
      action: "VENUE_EDIT",
      reason: "changed: type, capacity, status",
    });
  });

  // Forced store failures intentionally attempt one write; V18/V19/V31 assert the other method is untouched.
  it("V31: update store returns notFound -> NOT_FOUND and unchanged venue", async () => {
    const store = new FakeStore();
    store.forceNotFoundUpdate = true;
    const before = { ...store.venues.get("venue-CR1")! };
    const r = await performVenueWrite(store, computingRep, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-computing" },
    });
    expect(r).toEqual({ ok: false, kind: "NOT_FOUND" });
    expect(store.updateCalls).toHaveLength(1);
    expect(store.createCalls).toHaveLength(0);
    expect(store.venues.get("venue-CR1")).toEqual(before);
  });

  it("V32: failed edit leaves the stored venue unchanged", async () => {
    const store = new FakeStore();
    const before = { ...store.venues.get("venue-CR1")! };
    const r = await performVenueWrite(store, officer, {
      op: "EDIT",
      venueId: "venue-CR1",
      raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-unknown" },
    });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { owner: "Unknown department" } });
    expect(store.createCalls).toHaveLength(0);
    expect(store.updateCalls).toHaveLength(0);
    expect(store.venues.get("venue-CR1")).toEqual(before);
  });
});