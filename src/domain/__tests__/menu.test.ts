import { describe, it, expect } from "vitest";
import { MENU_ITEMS, menuForRole, type MenuItem } from "../menu";
import { ACTIONS, type Action } from "../permissions";
import { type UserRole } from "../types";

/** Literal expected key lists per role — not computed from the implementation. */
const EXPECTED_KEYS: Record<UserRole, string[]> = {
  ADMIN: ["timetable", "venue-status", "users"],
  OFFICER: [
    "timetable",
    "venue-status",
    "venue-register",
    "draft-editor",
    "generate",
    "reschedule-decide",
    "issues-list",
    "attendance-report",
  ],
  DEPT_REP: [
    "timetable",
    "venue-status",
    "venue-register",
    "submission-edit",
    "issues-new",
    "issues-list",
    "attendance-report",
  ],
  APPROVER: [
    "timetable",
    "venue-status",
    "submission-review",
    "issues-new",
    "issues-list",
    "attendance-report",
  ],
  LECTURER: [
    "timetable",
    "venue-status",
    "reschedule-request",
    "issues-new",
    "attendance-open",
    "attendance-report",
  ],
  STUDENT: ["timetable", "venue-status", "attendance-scan", "attendance-report"],
};

describe("MENU_ITEMS", () => {
  it("exactly one item is built, and it is venue-register", () => {
    expect(MENU_ITEMS).toHaveLength(15);
    const built = MENU_ITEMS.filter((item) => item.built);
    expect(built).toHaveLength(1);
    expect(built[0].key).toBe("venue-register");
    for (const item of MENU_ITEMS) {
      if (item.key !== "venue-register") {
        expect(item.built).toBe(false);
      }
    }
  });

  it("keys are unique", () => {
    const keys = MENU_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("hrefs are unique and start with /", () => {
    const hrefs = MENU_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
  });

  it("every item's action is in ACTIONS", () => {
    for (const item of MENU_ITEMS) {
      expect(ACTIONS.includes(item.action as Action)).toBe(true);
    }
  });
});

describe("menuForRole", () => {
  for (const [role, expected] of Object.entries(EXPECTED_KEYS)) {
    it(`returns exactly ${expected.join(", ")} for ${role}`, () => {
      const keys = menuForRole(role as UserRole).map((item) => item.key);
      expect(keys).toEqual(expected);
    });
  }

  it("preserves MENU_ITEMS order within each role", () => {
    const menuKeys = menuForRole("OFFICER").map((item) => item.key);
    const allKeys = MENU_ITEMS.map((item) => item.key);
    expect(menuKeys.every((key) => allKeys.indexOf(key) >= 0)).toBe(true);
    for (let i = 1; i < menuKeys.length; i++) {
      expect(allKeys.indexOf(menuKeys[i])).toBeGreaterThan(allKeys.indexOf(menuKeys[i - 1]));
    }
  });

  it("returns [] for an unknown role cast at runtime (never throws)", () => {
    expect(() => menuForRole("NOT_A_ROLE" as UserRole)).not.toThrow();
    expect(menuForRole("NOT_A_ROLE" as UserRole)).toEqual([]);
  });
});
