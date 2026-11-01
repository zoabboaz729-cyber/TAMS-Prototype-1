import { describe, it, expect } from "vitest";
import { changedVenueFields, auditReason } from "../venueAudit";
import type { StoredVenueFields } from "../venueAudit";

const base: StoredVenueFields = {
  code: "CR1",
  type: "ROOM",
  capacity: 60,
  ownerDepartmentId: "dept-computing",
  facilities: '["projector"]',
  status: "ACTIVE",
};

describe("changedVenueFields", () => {
  it("identical records -> []", () => {
    expect(changedVenueFields(base, { ...base })).toEqual([]);
  });
  it("code change", () => {
    expect(changedVenueFields(base, { ...base, code: "CR2" })).toEqual(["code"]);
  });
  it("type change", () => {
    expect(changedVenueFields(base, { ...base, type: "LAB" })).toEqual(["type"]);
  });
  it("capacity change", () => {
    expect(changedVenueFields(base, { ...base, capacity: 70 })).toEqual(["capacity"]);
  });
  it("facilities reordered -> []", () => {
    const a = { ...base, facilities: '["projector","computers"]' };
    const b = { ...base, facilities: '["computers","projector"]' };
    expect(changedVenueFields(a, b)).toEqual([]);
  });
  it('["projector"] vs ["computers"] -> ["facilities"]', () => {
    const a = { ...base, facilities: '["projector"]' };
    const b = { ...base, facilities: '["computers"]' };
    expect(changedVenueFields(a, b)).toEqual(["facilities"]);
  });
  it("invalid JSON equals []", () => {
    const a = { ...base, facilities: "not json" };
    const b = { ...base, facilities: "[]" };
    expect(changedVenueFields(a, b)).toEqual([]);
  });
  it("status change", () => {
    expect(changedVenueFields(base, { ...base, status: "INACTIVE" })).toEqual(["status"]);
  });
  it("owner change", () => {
    expect(changedVenueFields(base, { ...base, ownerDepartmentId: null })).toEqual(["owner"]);
  });
  it("several changes keep fixed order", () => {
    const after = { ...base, type: "LAB", capacity: 70, status: "INACTIVE" };
    expect(changedVenueFields(base, after)).toEqual(["type", "capacity", "status"]);
  });
});

describe("auditReason", () => {
  it("CREATE -> created", () => {
    expect(auditReason("CREATE", [])).toBe("created");
  });
  it("EDIT empty -> no changes", () => {
    expect(auditReason("EDIT", [])).toBe("no changes");
  });
  it("EDIT changed -> joined", () => {
    expect(auditReason("EDIT", ["type", "capacity", "status"])).toBe(
      "changed: type, capacity, status",
    );
  });
});