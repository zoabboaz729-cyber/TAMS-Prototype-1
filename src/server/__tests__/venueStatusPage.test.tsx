/** Static page/service integration; not browser interaction or layout acceptance. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES } from "@/domain/types";
import type { SafeUser } from "@/server/auth";
import type { VenueStatusStore } from "../venueStatusContract";
(globalThis as { React?: typeof React }).React = React;
const state = vi.hoisted(() => ({ guard: vi.fn(), read: vi.fn() }));
vi.mock("@/server/guards", () => ({ requireAnyAction: state.guard }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/venueStatusStorePrisma", () => ({ createVenueStatusStore: () => ({ readSnapshot: state.read } satisfies VenueStatusStore) }));
import Page from "@/app/venues/status/page";
const user = (role: SafeUser["role"] = "OFFICER"): SafeUser => ({ id: "actor", name: "Synthetic actor", email: "sample@example.test", role, departmentId: null, studentGroupId: null });
const fixture = () => ({
  versions: [{ id: "published-safe", semester: 1, status: "PUBLISHED", publishedAt: new Date("2026-11-08T00:00:00Z") }],
  venues: [{ id: "v", code: "CR1", type: "ROOM", status: "ACTIVE", unavailabilities: [] }],
  entries: [{ versionId: "published-safe", venueId: "v", unitSemester: 1, day: "MON", start: "08:00", end: "09:00", lecturerName: "PRIVATE_TEACHER" }],
});
async function render(query: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}
beforeEach(() => { vi.clearAllMocks(); state.guard.mockResolvedValue(user()); state.read.mockResolvedValue(fixture()); });
describe("M5-T2c authenticated page", () => {
  it("calls own guard before any snapshot read", async () => {
    await render(); expect(state.guard).toHaveBeenCalledWith("VIEW_VENUE_STATUS");
    expect(state.guard.mock.invocationCallOrder[0]).toBeLessThan(state.read.mock.invocationCallOrder[0]);
  });
  it("signed out redirect propagates without reading", async () => {
    state.guard.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login"); expect(state.read).not.toHaveBeenCalled();
  });
  it.each(USER_ROLES)("%s receives sanitized live board", async (role) => {
    state.guard.mockResolvedValue(user(role)); const html = await render();
    expect(html).toContain("CR1"); expect(html).toContain("Prototype — sample data");
    expect(html).toContain("Not a sensor reading or a booking guarantee"); expect(html).toContain("Africa/Nairobi");
    expect(html).toContain("published-safe"); expect(html).not.toContain("PRIVATE_TEACHER"); expect(html).not.toContain("Synthetic actor");
  });
  it.each([
    { role: "ADMIN" }, { versionId: "other" }, { semester: ["1", "2"] }, { semester: "3" },
    { mode: "live", day: "MON", time: "08:00" },
  ])("invalid query fails visibly %j without read", async (q) => {
    const html = await render(q); expect(html).toContain("Invalid venue status request"); expect(state.read).not.toHaveBeenCalled();
  });
  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER"] as const)("%s forged demo URL denied", async (role) => {
    state.guard.mockResolvedValue(user(role)); const html = await render({ mode: "demo", day: "MON", time: "08:00" });
    expect(html).toContain("not permitted"); expect(state.read).not.toHaveBeenCalled();
  });
  it("missing publication is never described as free", async () => {
    state.read.mockResolvedValue({ ...fixture(), versions: [] }); const html = await render({ semester: "2" });
    expect(html).toContain("No published timetable"); expect(html).toContain("Selected semester: 2"); expect(html).not.toContain("Free (schedule-derived)");
  });
  it("multiple publication error is actionable", async () => {
    const f = fixture(); f.versions.push({ ...f.versions[0], id: "other" }); state.read.mockResolvedValue(f);
    expect(await render()).toContain("Multiple current publications");
  });
  it("corrupt data and thrown store error reveal no private exception", async () => {
    state.read.mockResolvedValue({ ...fixture(), venues: [{ status: "BAD" }] }); expect(await render()).toContain("inconsistent");
    state.read.mockRejectedValue(new Error("password=SECRET /private/db SQL")); const html = await render();
    expect(html).toContain("Try again"); expect(html).not.toMatch(/SECRET|private|SQL/);
  });
  it("empty register differs from no publication", async () => {
    state.read.mockResolvedValue({ ...fixture(), venues: [], entries: [] }); expect(await render()).toContain("No venues registered");
  });
  it("all four states and same-day next-free are readable text", async () => {
    const f = fixture(); f.venues.push(
      { ...f.venues[0], id: "v2", code: "LAB2", status: "MAINTENANCE" },
      { ...f.venues[0], id: "v3", code: "GR1" }, { ...f.venues[0], id: "v4", code: "LH1" });
    f.entries.push({ ...f.entries[0], venueId: "v3", start: "08:30", end: "09:30" }); state.read.mockResolvedValue(f);
    const html = await render({ mode: "demo", day: "MON", time: "08:00" });
    for (const text of ["Occupied (scheduled)", "Upcoming class", "Free (schedule-derived)", "Unavailable", "MON 09:00 EAT", "not known until operational status changes"]) expect(html).toContain(text);
  });
});
