import { describe, it, expect } from "vitest";
import { isDemoEnabled, isDemoAccountEmail, DEMO_EMAIL_DOMAIN } from "../demoMode";

describe("isDemoEnabled", () => {
  it("enables demo mode for DEMO_MODE='true' in development", () => {
    expect(isDemoEnabled("true", "development")).toBe(true);
  });

  it("enables demo mode when NODE_ENV is undefined", () => {
    expect(isDemoEnabled("true", undefined)).toBe(true);
  });

  it("disables demo mode in production even with DEMO_MODE='true'", () => {
    expect(isDemoEnabled("true", "production")).toBe(false);
  });

  it.each(["false", "TRUE", "1", "", undefined])(
    "disables demo mode for DEMO_MODE=%p in development",
    (demoMode) => {
      expect(isDemoEnabled(demoMode, "development")).toBe(false);
    }
  );

  it.each(["false", "TRUE", "1", "", undefined])(
    "disables demo mode for DEMO_MODE=%p in production",
    (demoMode) => {
      expect(isDemoEnabled(demoMode, "production")).toBe(false);
    }
  );
});

describe("DEMO_EMAIL_DOMAIN", () => {
  it("is the demo domain constant", () => {
    expect(DEMO_EMAIL_DOMAIN).toBe("@demo.tams.test");
  });
});

describe("isDemoAccountEmail", () => {
  it.each(["officer@demo.tams.test", "OFFICER@Demo.Tams.Test"])("accepts %p", (email) => {
    expect(isDemoAccountEmail(email)).toBe(true);
  });

  it.each(["x@demo.tams.test.evil.com", "@demo.tams.test", "officer@example.com", ""])(
    "rejects %p",
    (email) => {
      expect(isDemoAccountEmail(email)).toBe(false);
    }
  );
});
