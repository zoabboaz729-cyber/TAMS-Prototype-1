import { describe, expect, it } from "vitest";
import { venueRequestFromFormData } from "../venueSubmission";

function completeForm(op: "CREATE" | "EDIT"): FormData {
  const formData = new FormData();
  formData.set("op", op);
  formData.set("code", "LH3");
  formData.set("type", "HALL");
  formData.set("capacity", "110");
  formData.set("status", "ACTIVE");
  formData.set("owner", "dept-mathematics");
  formData.append("facilities", "projector");
  return formData;
}

describe("venueRequestFromFormData", () => {
  it("parses a complete CREATE", () => {
    const result = venueRequestFromFormData(completeForm("CREATE"));
    expect(result).toEqual({
      ok: true,
      request: {
        op: "CREATE",
        raw: {
          code: "LH3",
          type: "HALL",
          capacity: "110",
          status: "ACTIVE",
          owner: "dept-mathematics",
          facilities: ["projector"],
        },
      },
      values: {
        code: "LH3",
        type: "HALL",
        capacity: "110",
        status: "ACTIVE",
        owner: "dept-mathematics",
        facilities: ["projector"],
      },
    });
  });

  it("parses a complete EDIT and trims its venueId", () => {
    const formData = completeForm("EDIT");
    formData.set("venueId", " venue-LH2 ");
    const result = venueRequestFromFormData(formData);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request).toMatchObject({ op: "EDIT", venueId: "venue-LH2" });
    }
  });

  it.each([
    ["missing venueId", undefined],
    ["blank venueId", "   "],
    ["101-character venueId", "v".repeat(101)],
  ])("rejects EDIT with %s", (_name, venueId) => {
    const formData = completeForm("EDIT");
    if (venueId !== undefined) formData.set("venueId", venueId);
    expect(venueRequestFromFormData(formData).ok).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["DELETE", "DELETE"],
    ["lowercase create", "create"],
  ])("rejects %s operation", (_name, op) => {
    const formData = new FormData();
    if (op !== undefined) formData.set("op", op);
    expect(venueRequestFromFormData(formData).ok).toBe(false);
  });

  it("keeps all submitted facility checkbox values", () => {
    const formData = completeForm("CREATE");
    formData.append("facilities", "computers");
    const result = venueRequestFromFormData(formData);
    expect(result.ok && result.values.facilities).toEqual([
      "projector",
      "computers",
    ]);
  });

  it("uses an empty facilities array when none are submitted", () => {
    const formData = completeForm("CREATE");
    formData.delete("facilities");
    const result = venueRequestFromFormData(formData);
    expect(result.ok && result.values.facilities).toEqual([]);
  });

  it("treats a File field as absent", () => {
    const formData = completeForm("CREATE");
    formData.set("code", new File(["x"], "x.txt"));
    const result = venueRequestFromFormData(formData);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.raw.code).toBeUndefined();
      expect(result.values.code).toBe("");
    }
  });

  it("ignores venueId for CREATE", () => {
    const formData = completeForm("CREATE");
    formData.set("venueId", "venue-LH2");
    const result = venueRequestFromFormData(formData);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request).not.toHaveProperty("venueId");
  });

  it("ignores unrecognized fields", () => {
    const formData = completeForm("CREATE");
    formData.set("role", "OFFICER");
    formData.set("ownerDepartmentId", "dept-computing");
    const result = venueRequestFromFormData(formData);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.raw).not.toHaveProperty("role");
      expect(result.request.raw).not.toHaveProperty("ownerDepartmentId");
      expect(Object.keys(result.request.raw).sort()).toEqual([
        "capacity",
        "code",
        "facilities",
        "owner",
        "status",
        "type",
      ]);
    }
  });

  it("echoes submitted values even when capacity is invalid", () => {
    const formData = completeForm("CREATE");
    formData.set("capacity", "not a capacity");
    const result = venueRequestFromFormData(formData);
    expect(result.ok && result.values.capacity).toBe("not a capacity");
    expect(result.ok && result.request.raw.capacity).toBe("not a capacity");
  });

  it("rejects empty FormData and returns empty values", () => {
    expect(venueRequestFromFormData(new FormData())).toEqual({
      ok: false,
      values: {
        code: "",
        type: "",
        capacity: "",
        status: "",
        owner: "",
        facilities: [],
      },
    });
  });
});
