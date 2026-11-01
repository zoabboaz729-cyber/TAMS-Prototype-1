import { describe, expect, it } from "vitest";
import {
  ALLOWED_FACILITIES,
  type AllowedFacility,
  VenueInputSchema,
  venueOwnership,
} from "../venueSchema";
import type { VenueInput } from "../venueSchema";

/** Valid venue input; overrides are merged in for the success cases. */
function validInput(overrides: Partial<VenueInput> = {}): VenueInput {
  return {
    code: "CR1",
    type: "ROOM",
    capacity: 60,
    facilities: ["projector"],
    status: "ACTIVE",
    ownerDepartmentId: "dept-computing",
    ...overrides,
  };
}

/** safeParse accepts any value; invalid inputs are typed as unknown here on purpose. */
function parse(input: unknown) {
  return VenueInputSchema.safeParse(input);
}

describe("VenueInputSchema", () => {
  it("accepts a valid venue input", () => {
    const result = parse(validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("CR1");
      expect(result.data.type).toBe("ROOM");
      expect(result.data.capacity).toBe(60);
      expect(result.data.ownerDepartmentId).toBe("dept-computing");
    }
  });

  it("trims and uppercases the code: ' cr1 ' becomes 'CR1'", () => {
    const result = parse({ ...validInput(), code: " cr1 " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("CR1");
  });

  it("rejects a 1-character code", () => {
    expect(parse({ ...validInput(), code: "C" }).success).toBe(false);
  });

  it("rejects an 11-character code", () => {
    expect(parse({ ...validInput(), code: "CR123456789" }).success).toBe(false);
  });

  it("rejects a code containing a space", () => {
    expect(parse({ ...validInput(), code: "CR 1" }).success).toBe(false);
  });

  it("rejects a code containing an underscore", () => {
    expect(parse({ ...validInput(), code: "CR_1" }).success).toBe(false);
  });

  it("rejects capacity 0, -5, 1.5, 1001 and the numeric string '60'", () => {
    for (const bad of [0, -5, 1.5, 1001, "60"] as (number | string)[]) {
      expect(
        parse({ ...validInput(), capacity: bad as unknown as number }).success,
      ).toBe(false);
    }
  });

  it("accepts the capacity boundaries 1 and 1000", () => {
    for (const good of [1, 1000]) {
      const result = parse({ ...validInput(), capacity: good });
      expect(result.success).toBe(true);
    }
  });

  it("rejects duplicate facilities", () => {
    expect(
      parse({
        ...validInput(),
        facilities: ["projector", "projector"] as AllowedFacility[],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown facility", () => {
    expect(
      parse({
        ...validInput(),
        facilities: ["projector", "coffee-break"] as AllowedFacility[],
      }).success,
    ).toBe(false);
  });

  it("rejects five facilities (maximum is four)", () => {
    expect(
      parse({
        ...validInput(),
        facilities: [
          "projector",
          "computers",
          "whiteboard",
          "accessible",
          "projector",
        ] as AllowedFacility[],
      }).success,
    ).toBe(false);
  });

  it("defaults facilities to an empty array", () => {
    const { facilities: _ignored, ...rest } = validInput();
    const result = parse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.facilities).toEqual([]);
  });

  it("defaults status to ACTIVE", () => {
    const { status: _ignored, ...rest } = validInput();
    const result = parse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("ACTIVE");
  });

  it("rejects an empty ownerDepartmentId string and whitespace-only string", () => {
    expect(parse({ ...validInput(), ownerDepartmentId: "" }).success).toBe(false);
    expect(parse({ ...validInput(), ownerDepartmentId: "   " }).success).toBe(
      false,
    );
  });

  it("accepts null ownerDepartmentId (shared venue)", () => {
    const result = parse({ ...validInput(), ownerDepartmentId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ownerDepartmentId).toBeNull();
  });

  it("rejects an ownerDepartmentId longer than 100 characters", () => {
    expect(
      parse({
        ...validInput(),
        ownerDepartmentId: "a".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("accepts ownerDepartmentId 'dept-computing'", () => {
    const result = parse(validInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ownerDepartmentId).toBe("dept-computing");
  });

  it("rejects a missing ownerDepartmentId key", () => {
    const input = validInput();
    delete (input as Record<string, unknown>).ownerDepartmentId;
    expect(parse(input).success).toBe(false);
  });

  it("rejects ownerDepartmentId explicitly set to undefined", () => {
    expect(
      parse({ ...validInput(), ownerDepartmentId: undefined } as unknown).success,
    ).toBe(false);
  });
});

describe("venueOwnership", () => {
  it("returns SHARED for a null owner", () => {
    expect(venueOwnership(null)).toBe("SHARED");
  });

  it("returns OWNED for a department id", () => {
    expect(venueOwnership("dept-computing")).toBe("OWNED");
    expect(venueOwnership("dept-mathematics")).toBe("OWNED");
  });
});

describe("ALLOWED_FACILITIES", () => {
  it("contains exactly projector, computers, whiteboard, accessible", () => {
    expect(ALLOWED_FACILITIES).toEqual([
      "projector",
      "computers",
      "whiteboard",
      "accessible",
    ]);
  });
});
