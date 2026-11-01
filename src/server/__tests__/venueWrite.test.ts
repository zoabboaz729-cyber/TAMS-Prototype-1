import { describe, it, expect } from "vitest";
import { performVenueWrite } from "../venueWrite";
import type { VenueStore, StoredVenue, StoredVenueFields, AuditDraft } from "../venueWrite";
import { seedVenues, seedDepartments } from "../../domain/seedData";
import { serializeJsonFacilities } from "../../domain/types";

type Actor = { id: string; role: any; departmentId: string | null; studentGroupId: string | null };

function actor(id: string, role: any, departmentId: string | null = null, studentGroupId: string | null = null): Actor {
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
    const existing = this.venues.get(id);
    if (!existing) return { notFound: true } as const;
    this.venues.set(id, { id, ...fields });
    return { ok: true } as const;
  }
}

const validRaw = {
  code: "NEW1",
  type: "ROOM",
  capacity: "40",
  facilities: ["projector"],
  status: "ACTIVE",
  owner: "dept-computing",
};

describe("performVenueWrite", () => {
  it("null actor -> UNAUTHENTICATED", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, null, { op: "CREATE", raw: validRaw as any });
    expect(r).toEqual({ ok: false, kind: "UNAUTHENTICATED" });
    expect(store.createCalls).toHaveLength(0);
  });

  it("officer create shared", async () => {
    const store = new FakeStore();
    const raw = { ...validRaw, owner: "__SHARED__" };
    const r = await performVenueWrite(store, officer as any, { op: "CREATE", raw: raw as any });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = await store.findVenue(r.venueId);
      expect(v?.code).toBe("NEW1");
      expect(v?.ownerDepartmentId).toBeNull();
      expect(v?.facilities).toBe('["projector"]');
    }
    expect(store.auditDrafts[0]).toEqual({ actorId: "user-officer", action: "VENUE_CREATE", reason: "created" });
  });

  it("invalid form from officer", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer as any, { op: "CREATE", raw: { code: "NEW1", type: "ROOM", capacity: "abc", facilities: [], owner: undefined } as any });
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === "VALIDATION") {
      expect(r.errors.capacity).toBe("Capacity must be a whole number from 1 to 1000");
      expect(r.errors.owner).toBe("Choose an owner or Shared");
    }
    expect(store.createCalls).toHaveLength(0);
  });

  it("duplicate code create", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, officer as any, { op: "CREATE", raw: { ...validRaw, code: "CR1" } as any });
    expect(r).toEqual({ ok: false, kind: "VALIDATION", errors: { code: "A venue with this code already exists" } });
    expect(store.createCalls).toHaveLength(0);
  });

  it("computing rep edit CR1 capacity", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep as any, { op: "EDIT", venueId: "venue-CR1", raw: { code: "CR1", type: "ROOM", capacity: "70", facilities: [], status: "ACTIVE", owner: "dept-computing" } as any });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: true });
    const v = await store.findVenue("venue-CR1");
    expect(v?.capacity).toBe(70);
    const last = store.auditDrafts[store.auditDrafts.length - 1];
    expect(last).toEqual({ actorId: "user-deptrep-computing", action: "VENUE_EDIT", reason: "changed: capacity" });
  });

  it("no-op edit", async () => {
    const store = new FakeStore();
    const r = await performVenueWrite(store, computingRep as any, { op: "EDIT", venueId: "venue-CR1", raw: { code: "CR1", type: "ROOM", capacity: "60", facilities: [], status: "ACTIVE", owner: "dept-computing" } as any });
    expect(r).toEqual({ ok: true, venueId: "venue-CR1", changed: false });
    expect(store.updateCalls).toHaveLength(0);
  });

});