import { describe, it, expect } from "vitest";
import { LoginSchema, normaliseLoginEmail } from "../loginSchema";

describe("LoginSchema", () => {
  it("accepts a padded email and returns it trimmed", () => {
    const parsed = LoginSchema.safeParse({
      email: " officer@demo.tams.test ",
      password: "password",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("officer@demo.tams.test");
    }
  });

  it("accepts an uppercase email and normalises it to lowercase", () => {
    const parsed = LoginSchema.safeParse({
      email: "OFFICER@Demo.Tams.Test",
      password: "password",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(normaliseLoginEmail(parsed.data.email)).toBe(
        "officer@demo.tams.test",
      );
    }
  });

  it("rejects an empty email", () => {
    const parsed = LoginSchema.safeParse({
      email: "",
      password: "password",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-email string", () => {
    const parsed = LoginSchema.safeParse({
      email: "not-an-email",
      password: "password",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const parsed = LoginSchema.safeParse({
      email: "officer@demo.tams.test",
      password: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("preserves leading and trailing spaces in the password exactly", () => {
    const parsed = LoginSchema.safeParse({
      email: "officer@demo.tams.test",
      password: "  p@ssw0rd  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.password).toBe("  p@ssw0rd  ");
    }
  });
});