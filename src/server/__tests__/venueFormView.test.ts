import { describe, expect, it } from "vitest";
import {
  emptyVenueFormValues,
  venueFormValuesFromStored,
  venueNoticeFor,
} from "../venueFormView";

describe("emptyVenueFormValues", () => {
  it("uses the supplied department as the owner", () => {
    expect(emptyVenueFormValues("dept-computing")).toEqual({
      code: "",
      type: "ROOM",
      capacity: "",
      status: "ACTIVE",
      owner: "dept-computing",
      facilities: [],
    });
  });

  it("keeps an empty owner when multiple options are available", () => {
    expect(emptyVenueFormValues("")).toEqual({
      code: "",
      type: "ROOM",
      capacity: "",
      status: "ACTIVE",
      owner: "",
      facilities: [],
    });
  });
});

describe("venueFormValuesFromStored", () => {
  it("converts stored fields and facilities into form values", () => {
    expect(
      venueFormValuesFromStored({
        code: "CR1",
        type: "LAB",
        capacity: 60,
        ownerDepartmentId: "dept-computing",
        facilities: '["projector","computers"]',
        status: "ACTIVE",
      }),
    ).toEqual({
      code: "CR1",
      type: "LAB",
      capacity: "60",
      status: "ACTIVE",
      owner: "dept-computing",
      facilities: ["projector", "computers"],
    });
  });

  it("uses the shared owner sentinel for an unowned venue", () => {
    expect(
      venueFormValuesFromStored({
        code: "GR1",
        type: "ROOM",
        capacity: 60,
        ownerDepartmentId: null,
        facilities: "[]",
        status: "ACTIVE",
      }).owner,
    ).toBe("__SHARED__");
  });

  it("uses an empty facility list for invalid JSON", () => {
    expect(
      venueFormValuesFromStored({
        code: "CR1",
        type: "ROOM",
        capacity: 60,
        ownerDepartmentId: "dept-computing",
        facilities: "not json",
        status: "ACTIVE",
      }).facilities,
    ).toEqual([]);
  });
});

describe("venueNoticeFor", () => {
  it.each([
    ["created", { tone: "success", text: "Venue created." }],
    ["updated", { tone: "success", text: "Venue updated." }],
    ["unchanged", { tone: "info", text: "No changes were made." }],
    ["not_found", { tone: "warning", text: "That venue could not be found." }],
  ] as const)("returns the fixed notice for %s", (key, expected) => {
    expect(venueNoticeFor(key)).toEqual(expected);
  });

  const invalidValues: (string | string[] | undefined)[] = [
    "created ",
    "CREATED",
    "toString",
    "__proto__",
    "",
    ["created"],
    undefined,
  ];

  it.each(invalidValues)("rejects an unsupported notice value", (value) => {
    expect(venueNoticeFor(value)).toBeNull();
  });
});
