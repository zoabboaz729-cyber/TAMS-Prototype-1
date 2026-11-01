import { describe, it, expect } from "vitest";
import { parseVenueForm, SHARED_OWNER_VALUE } from "../venueForm";

describe("parseVenueForm", () => {
  it("parses a fully valid form", () => {
    const result = parseVenueForm({
      code: " cr9 ",
      type: "ROOM",
      capacity: "60",
      facilities: ["projector"],
      owner: "dept-computing",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        code: "CR9",
        type: "ROOM",
        capacity: 60,
        facilities: ["projector"],
        status: "ACTIVE",
        ownerDepartmentId: "dept-computing",
      },
    });
  });

  it("SHARED owner gives null ownerDepartmentId", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: SHARED_OWNER_VALUE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ownerDepartmentId).toBeNull();
    }
  });

  it("owner missing/empty/whitespace/non-string errors", () => {
    for (const owner of [undefined, "", "   ", 42]) {
      const result = parseVenueForm({
        code: "CR1",
        type: "ROOM",
        capacity: "40",
        facilities: [],
        owner,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.owner).toBe("Choose an owner or Shared");
      }
    }
  });

  it("capacity invalid values error", () => {
    for (const capacity of ["12abc", "1.5", "-3", " 40 ", "", "0", "1001", 60, "99999"]) {
      const result = parseVenueForm({
        code: "CR1",
        type: "ROOM",
        capacity,
        facilities: [],
        owner: "dept-computing",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.capacity).toBeTruthy();
      }
    }
  });

  it("capacity '1' and '1000' pass", () => {
    for (const capacity of ["1", "1000"]) {
      const result = parseVenueForm({
        code: "CR1",
        type: "ROOM",
        capacity,
        facilities: [],
        owner: "dept-computing",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("capacity bad string gives exact message", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "12abc",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.capacity).toBe("Capacity must be a whole number from 1 to 1000");
    }
  });

  it("facilities missing gives []", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      owner: "dept-computing",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.facilities).toEqual([]);
    }
  });

  it("facilities single string gives array", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: "projector",
      owner: "dept-computing",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.facilities).toEqual(["projector"]);
    }
  });

  it("facilities duplicate errors", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: ["projector", "projector"],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.facilities).toBe("Duplicate facilities are not allowed");
    }
  });

  it("facilities lasers errors", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: ["lasers"],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.facilities).toBeTruthy();
    }
  });

  it("facilities non-string array errors Invalid facilities", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: [1, 2],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.facilities).toBe("Invalid facilities");
    }
  });

  it("facilities five entries errors", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: ["projector", "computers", "whiteboard", "accessible", "projector"],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.facilities).toBeTruthy();
    }
  });

  it("code 'C' errors", () => {
    const result = parseVenueForm({
      code: "C",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.code).toBeTruthy();
    }
  });

  it("code 'CR 1' errors", () => {
    const result = parseVenueForm({
      code: "CR 1",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.code).toBeTruthy();
    }
  });

  it("type BOGUS errors", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "BOGUS",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.type).toBe("Choose a valid venue type");
    }
  });

  it("status missing defaults to ACTIVE", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("ACTIVE");
    }
  });

  it("several bad fields return every error at once", () => {
    const result = parseVenueForm({
      code: "C",
      type: "BOGUS",
      capacity: "abc",
      facilities: [1, 2],
      owner: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.code).toBeTruthy();
      expect(result.errors.type).toBeTruthy();
      expect(result.errors.capacity).toBeTruthy();
      expect(result.errors.facilities).toBe("Invalid facilities");
      expect(result.errors.owner).toBe("Choose an owner or Shared");
    }
  });

  it("V33: missing code -> Venue code is required", () => {
    const result = parseVenueForm({
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.code).toBe("Venue code is required");
    }
  });

  it("V34: type BOGUS -> Choose a valid venue type", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "BOGUS",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.type).toBe("Choose a valid venue type");
    }
  });

  it("V35: status BOGUS -> Choose a valid status", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      status: "BOGUS",
      owner: "dept-computing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.status).toBe("Choose a valid status");
    }
  });

  it("extra unknown keys are ignored", () => {
    const result = parseVenueForm({
      code: "CR1",
      type: "ROOM",
      capacity: "40",
      facilities: [],
      owner: "dept-computing",
      foo: "bar",
      extra: 5,
    } as any);
    expect(result.ok).toBe(true);
  });

  it("calling with {} returns errors for code, type, capacity, owner and never throws", () => {
    let result: ReturnType<typeof parseVenueForm> | undefined;
    expect(() => {
      result = parseVenueForm({});
    }).not.toThrow();
    expect(result).toBeDefined();
    if (result && !result.ok) {
      expect(result.errors.code).toBe("Venue code is required");
      expect(result.errors.type).toBe("Choose a valid venue type");
      expect(result.errors.capacity).toBe("Capacity must be a whole number from 1 to 1000");
      expect(result.errors.owner).toBe("Choose an owner or Shared");
    }
  });
});
