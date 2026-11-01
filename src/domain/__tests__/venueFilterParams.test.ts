import { describe, it, expect } from "vitest";
import { parseVenueFilterParams } from "../venueFilterParams";
import type { VenueFilter } from "../venueRules";

type Params = Record<string, string | string[] | undefined>;

describe("parseVenueFilterParams", () => {
  it("empty params → {}", () => {
    expect(parseVenueFilterParams({})).toEqual({});
  });

  it("parses each valid key on its own", () => {
    expect(parseVenueFilterParams({ type: "LAB" })).toEqual({ type: "LAB" });
    expect(parseVenueFilterParams({ type: "ROOM" })).toEqual({ type: "ROOM" });
    expect(parseVenueFilterParams({ type: "HALL" })).toEqual({ type: "HALL" });
    expect(parseVenueFilterParams({ ownership: "ALL" })).toEqual({
      ownership: "ALL",
    });
    expect(parseVenueFilterParams({ ownership: "SHARED" })).toEqual({
      ownership: "SHARED",
    });
    expect(parseVenueFilterParams({ ownership: "OWNED" })).toEqual({
      ownership: "OWNED",
    });
    expect(parseVenueFilterParams({ owner: "dept-computing" })).toEqual({
      ownerDepartmentId: "dept-computing",
    });
    expect(parseVenueFilterParams({ owner: "  dept-computing  " })).toEqual({
      ownerDepartmentId: "dept-computing",
    });
    expect(parseVenueFilterParams({ minCapacity: "1" })).toEqual({
      minCapacity: 1,
    });
    expect(parseVenueFilterParams({ minCapacity: "40" })).toEqual({
      minCapacity: 40,
    });
    expect(parseVenueFilterParams({ minCapacity: "1000" })).toEqual({
      minCapacity: 1000,
    });
    expect(parseVenueFilterParams({ status: "ACTIVE" })).toEqual({
      status: "ACTIVE",
    });
    expect(parseVenueFilterParams({ status: "INACTIVE" })).toEqual({
      status: "INACTIVE",
    });
    expect(parseVenueFilterParams({ status: "MAINTENANCE" })).toEqual({
      status: "MAINTENANCE",
    });
    expect(parseVenueFilterParams({ q: "lab" })).toEqual({ text: "lab" });
    expect(parseVenueFilterParams({ q: "  CR3  " })).toEqual({ text: "CR3" });
  });

  it("ignores each invalid value for every key", () => {
    expect(parseVenueFilterParams({ type: "ROOMS" })).toEqual({});
    expect(parseVenueFilterParams({ type: "room" })).toEqual({});
    expect(parseVenueFilterParams({ ownership: "all" })).toEqual({});
    expect(parseVenueFilterParams({ ownership: "shared" })).toEqual({});
    expect(parseVenueFilterParams({ ownership: "OTHER" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "12abc" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "-5" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "1.5" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "0" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "1001" })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: " 40 " })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: "10000" })).toEqual({});
    expect(parseVenueFilterParams({ status: "BROKEN" })).toEqual({});
    expect(parseVenueFilterParams({ status: "active" })).toEqual({});
    expect(parseVenueFilterParams({ q: "" })).toEqual({});
    expect(parseVenueFilterParams({ q: "   " })).toEqual({});
    expect(
      parseVenueFilterParams({ q: "this-is-way-too-long!" }),
    ).toEqual({});
    expect(parseVenueFilterParams({ owner: "" })).toEqual({});
    expect(parseVenueFilterParams({ owner: "   " })).toEqual({});
  });

  it("ignores array values (repeated keys)", () => {
    expect(parseVenueFilterParams({ type: ["HALL", "LAB"] })).toEqual({});
    expect(parseVenueFilterParams({ ownership: ["ALL", "SHARED"] })).toEqual(
      {},
    );
    expect(parseVenueFilterParams({ owner: ["dept-computing"] })).toEqual({});
    expect(parseVenueFilterParams({ minCapacity: ["40"] })).toEqual({});
    expect(parseVenueFilterParams({ status: ["ACTIVE"] })).toEqual({});
    expect(parseVenueFilterParams({ q: ["lab"] })).toEqual({});
  });

  it("parses all six valid keys together", () => {
    expect(
      parseVenueFilterParams({
        type: "ROOM",
        ownership: "OWNED",
        owner: "dept-math",
        minCapacity: "50",
        status: "ACTIVE",
        q: "CR",
      }),
    ).toEqual({
      type: "ROOM",
      ownership: "OWNED",
      ownerDepartmentId: "dept-math",
      minCapacity: 50,
      status: "ACTIVE",
      text: "CR",
    });
  });

  it("ignores unknown keys", () => {
    expect(
      parseVenueFilterParams({ type: "ROOM", foo: "bar", page: "2" }),
    ).toEqual({ type: "ROOM" });
    expect(
      parseVenueFilterParams({ type: "ROOM", owner: undefined }),
    ).toEqual({ type: "ROOM" });
  });

  it("ignores keys named toString and __proto__ (Object.hasOwn guard)", () => {
    const expected: VenueFilter = { type: "ROOM", ownerDepartmentId: "dept-computing" };

    // "toString" is an ordinary own property here, but not a filter key.
    const withToString: Params = {
      type: "ROOM",
      owner: "dept-computing",
      toString: "HALL",
    };
    expect(parseVenueFilterParams(withToString)).toEqual(expected);

    // "__proto__" as an own (enumerable) property must never be read either.
    const withProto = Object.create(null) as Params;
    withProto.type = "ROOM";
    withProto.owner = "dept-computing";
    Object.defineProperty(withProto, "__proto__", {
      enumerable: true,
      value: "owned",
      writable: true,
      configurable: true,
    });
    expect(parseVenueFilterParams(withProto)).toEqual(expected);
  });
});
