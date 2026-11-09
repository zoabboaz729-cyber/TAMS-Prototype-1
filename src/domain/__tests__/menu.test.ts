import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_ITEMS, menuForRole, type MenuItem } from "../menu";
import { ACTIONS, permissionScope, type Action } from "../permissions";
import { decideAnyAccess } from "../access";
import { USER_ROLES, type UserRole } from "../types";
import type { SafeUser } from "@/server/auth";

// M4-T4e: the homepage confirmation renders the real, unchanged src/app/page.tsx
// through react-dom/server (the same preserved-JSX/global-React pattern as the
// accepted page suite). Only the session boundary is mocked, so no database,
// cookie or auth module loads; menuForRole, roleLabel and the homepage's
// item.built link/"Coming soon" branch all run for real.
(globalThis as { React?: typeof React }).React = React;

const h = vi.hoisted(() => ({
  user: null as SafeUser | null,
}));

vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => h.user,
}));

const { default: HomePage } = await import("@/app/page");

/** Literal expected key lists per role — not computed from the implementation. */
const EXPECTED_KEYS: Record<UserRole, string[]> = {
  ADMIN: ["timetable", "venue-status", "users"],
  OFFICER: [
    "timetable",
    "venue-status",
    "venue-register",
    "submission-overview",
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
    "lecturer-availability",
    "issues-new",
    "attendance-open",
    "attendance-report",
  ],
  STUDENT: ["timetable", "venue-status", "attendance-scan", "attendance-report"],
};

describe("MENU_ITEMS", () => {
  it("fifteen delivered items are built, including the three M7 destinations", () => {
    expect(MENU_ITEMS).toHaveLength(17);
    const built = MENU_ITEMS.filter((item) => item.built).map((item) => item.key);
    expect(built).toEqual([
      "timetable",
      "venue-status",
      "venue-register",
      "submission-edit",
      "submission-review",
      "submission-overview",
      "draft-editor",
      "reschedule-decide",
      "reschedule-request",
      "lecturer-availability",
      "issues-new",
      "issues-list",
      "attendance-open",
      "attendance-scan",
      "attendance-report",
    ]);
    for (const item of MENU_ITEMS) {
      if (!built.includes(item.key)) {
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

  it("shows My availability to lecturers only, although officers/admins hold the VIEW action", () => {
    // The sidebar audience (audienceRoles) is narrower than the read
    // permission by design; the server guard, not this list, enforces access.
    expect(menuForRole("OFFICER").map((item) => item.key)).not.toContain("lecturer-availability");
    expect(menuForRole("ADMIN").map((item) => item.key)).not.toContain("lecturer-availability");
    expect(menuForRole("LECTURER").map((item) => item.key)).toContain("lecturer-availability");
  });
});

// --- M4-T4e: published-timetable navigation activation ---------------------

describe("Timetable navigation activation (M4-T4e)", () => {
  it("1-3. exactly one Timetable entry exists: built, href /timetable, action VIEW_TIMETABLE", () => {
    const matches = MENU_ITEMS.filter((item) => item.key === "timetable");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      key: "timetable",
      label: "Timetable",
      href: "/timetable",
      action: "VIEW_TIMETABLE",
      built: true,
    });
  });

  it("4-5. all six authorized roles receive exactly one built Timetable item in the original first position", () => {
    expect(MENU_ITEMS[0].key).toBe("timetable");
    for (const role of USER_ROLES) {
      const items = menuForRole(role);
      const matches = items.filter((item) => item.key === "timetable");
      expect(matches).toHaveLength(1);
      expect(matches[0].built).toBe(true);
      expect(items[0].key).toBe("timetable");
      expect(permissionScope(role, "VIEW_TIMETABLE")).not.toBe("NONE");
    }
  });

  it("6. only delivered features are built; generator alias and user management remain unbuilt", () => {
    const unbuilt = [
      "generate",
      "users",
    ];
    for (const key of unbuilt) {
      expect(MENU_ITEMS.find((item) => item.key === key)?.built).toBe(false);
    }
    const stillBuilt = [
      "attendance-open",
      "attendance-scan",
      "attendance-report",
      "reschedule-decide",
      "reschedule-request",
      "issues-new",
      "issues-list",
      "venue-status",
      "venue-register",
      "submission-edit",
      "submission-review",
      "submission-overview",
      "draft-editor",
      "lecturer-availability",
    ];
    for (const key of stillBuilt) {
      expect(MENU_ITEMS.find((item) => item.key === key)?.built).toBe(true);
    }
  });

  it("7. an unknown runtime role still receives no menu items, Timetable included", () => {
    expect(menuForRole("NOT_A_ROLE" as UserRole)).toEqual([]);
  });

  it("8. audience restrictions are unchanged: My availability stays lecturer-only and Timetable has no audience override", () => {
    expect(MENU_ITEMS.find((item) => item.key === "lecturer-availability")?.audienceRoles).toEqual(["LECTURER"]);
    expect(MENU_ITEMS.find((item) => item.key === "timetable")?.audienceRoles).toBeUndefined();
    expect(permissionScope("OFFICER", "VIEW_LECTURER_AVAILABILITY")).not.toBe("NONE");
    expect(permissionScope("ADMIN", "VIEW_LECTURER_AVAILABILITY")).not.toBe("NONE");
    expect(menuForRole("OFFICER").map((item) => item.key)).not.toContain("lecturer-availability");
    expect(menuForRole("ADMIN").map((item) => item.key)).not.toContain("lecturer-availability");
    expect(menuForRole("LECTURER").map((item) => item.key)).toContain("lecturer-availability");
  });

  it("9. the menu grants no authority: every shown item matches the guard layer's decisions and menu.ts imports only the pure matrix", () => {
    for (const role of USER_ROLES) {
      const actor = { id: `user-${role}`, role, departmentId: null, studentGroupId: null };
      for (const item of menuForRole(role)) {
        expect(decideAnyAccess(actor, item.action).status).toBe("ALLOW");
      }
      // The exact decision /timetable's requireAnyAction("VIEW_TIMETABLE") makes.
      expect(decideAnyAccess(actor, "VIEW_TIMETABLE").status).toBe("ALLOW");
    }
    expect(decideAnyAccess(null, "VIEW_TIMETABLE").status).toBe("UNAUTHENTICATED");
    const source = readFileSync(join(process.cwd(), "src/domain/menu.ts"), "utf8");
    const importLines = source.split(/\r?\n/).filter((line) => line.startsWith("import "));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/from "\.\/(types|permissions)"/);
    }
    expect(source).not.toContain("@/server");
    expect(source).not.toContain("requireAction");
  });

  it("10. the unchanged homepage renders Timetable as a link for every role and keeps unbuilt features as Coming soon", async () => {
    for (const role of USER_ROLES) {
      h.user = { id: `user-${role.toLowerCase()}`, name: "Demo User", email: "demo@example.ac.ke", role, departmentId: null, studentGroupId: null };
      const markup = renderToStaticMarkup(await HomePage());
      expect(markup).toContain('href="/timetable"');
      expect((markup.match(/href="\/timetable"/g) ?? []).length).toBe(1);
      expect(markup).toContain(">Timetable</a>");
      expect(markup).not.toContain("Timetable — Coming soon");
    }
    h.user = { id: "user-student", name: "Student A", email: "student@example.ac.ke", role: "STUDENT", departmentId: null, studentGroupId: "group-1" };
    const studentMarkup = renderToStaticMarkup(await HomePage());
    expect(studentMarkup).toContain('href="/venues/status"');
    expect(studentMarkup).not.toContain("Venue status — Coming soon");
    expect(studentMarkup).toContain('href="/student/scan"');
    expect(studentMarkup).not.toContain("Scan attendance — Coming soon");
    expect(studentMarkup).toContain('href="/reports/attendance"');
    expect(studentMarkup).not.toContain("Attendance reports — Coming soon");
    h.user = null;
    const signedOut = renderToStaticMarkup(await HomePage());
    expect(signedOut).not.toContain('href="/timetable"');
    expect(signedOut).toContain("Sign in");
  });
});


describe("M5-T2e venue status navigation", () => {
  it.each(USER_ROLES)("%s gets exactly one built status link without register permission changes", async (role) => {
    const links = menuForRole(role).filter((item) => item.key === "venue-status");
    expect(links).toEqual([{ key: "venue-status", label: "Venue status", href: "/venues/status", action: "VIEW_VENUE_STATUS", built: true }]);
    h.user = { id: "sample-user", name: "Synthetic", email: "sample@example.test", role, departmentId: null, studentGroupId: null };
    const markup = renderToStaticMarkup(await HomePage());
    expect((markup.match(/href="\/venues\/status"/g) ?? [])).toHaveLength(1);
    expect(markup).not.toContain("Venue status — Coming soon");
    expect(menuForRole(role).some((item) => item.key === "venue-register")).toBe(permissionScope(role, "DECLARE_VENUE") !== "NONE");
  });
});
