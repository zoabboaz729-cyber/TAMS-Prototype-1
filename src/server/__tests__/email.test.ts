import { describe, it, expect } from "vitest";
import { normaliseEmail } from "../email";

describe("normaliseEmail", () => {
  it("trims surrounding spaces", () => {
    expect(normaliseEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("lowercases uppercase letters", () => {
    expect(normaliseEmail("JOHN.DOE@KISII.AC.KE")).toBe("john.doe@kisii.ac.ke");
  });

  it("returns an already normal address unchanged", () => {
    expect(normaliseEmail("alice@example.com")).toBe("alice@example.com");
  });

  it("returns an empty string for an empty input", () => {
    expect(normaliseEmail("")).toBe("");
  });
});
