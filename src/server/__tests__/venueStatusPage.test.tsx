/** Static page/service integration; not browser interaction or layout acceptance. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES } from "@/domain/types";
import type { SafeUser } from "@/server/auth";
import type { VenueStatusStore } from "../venueStatusContract";
(globalThis as { React?: typeof React }).React = React;
const state = vi.hoisted(() => ({ guard: vi.fn(), read: vi.fn(), refresh: vi.fn(), effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (original) => ({ ...await original<typeof React>(), useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => { state.effects.length = 0; vi.clearAllMocks(); state.guard.mockResolvedValue(user()); state.read.mockResolvedValue(fixture()); });
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


describe("M5-T2d clock control markup and effect lifecycle", () => {
  it.each(["OFFICER", "ADMIN"] as const)("%s has labelled simulated controls and native GET Apply", async (role) => {
    state.guard.mockResolvedValue(user(role)); const html = await render({ mode: "demo", day: "MON", time: "07:30" });
    for (const text of ['aria-label="Simulated venue clock"', 'name="mode" value="demo"', 'name="day"', 'type="time"', 'step="60"', 'method="get"', 'action="/venues/status"', "Apply simulated time", "Reset to live", "Simulated time — not live", "MON 07:30 EAT"]) expect(html).toContain(text);
    for (const id of ["venue-live-semester", "venue-demo-semester", "venue-demo-day", "venue-demo-time"]) {
      expect(html).toContain(`for="${id}"`); expect(html).toContain(`id="${id}"`);
    }
  });
  it.each(["STUDENT", "LECTURER", "DEPT_REP", "APPROVER"] as const)("%s has live selector only", async (role) => {
    state.guard.mockResolvedValue(user(role)); const html = await render();
    expect(html).toContain('aria-label="Live semester selector"'); expect(html).not.toContain('aria-label="Simulated venue clock"');
    expect(html).not.toContain('name="time"'); expect(html).not.toContain('name="day"');
  });
  it.each([["07:29", "Free (schedule-derived)"], ["07:30", "Upcoming class"], ["08:00", "Occupied (scheduled)"], ["09:00", "Free (schedule-derived)"]])("server rendered demo %s transitions to %s", async (time, text) => {
    const html = await render({ mode: "demo", day: "MON", time }); expect(html).toContain(text); expect(html).toContain(`MON ${time} EAT`);
  });
  it("invalid arbitrary demo time reports INVALID_CLOCK before reads", async () => {
    expect(await render({ mode: "demo", day: "MON", time: "25:00" })).toContain("Invalid clock"); expect(state.read).not.toHaveBeenCalled();
  });
  it("live timer refreshes every minute while visible, returns to tab, and cleans up", async () => {
    vi.useFakeTimers(); const document = new EventTarget();
    let visibility = "visible"; Object.defineProperty(document, "visibilityState", { get: () => visibility });
    vi.stubGlobal("document", document); vi.stubGlobal("window", { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    await render(); expect(state.effects).toHaveLength(1);
    const cleanup = state.effects[0](); expect(cleanup).toBeTypeOf("function");
    vi.advanceTimersByTime(59_999); expect(state.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(state.refresh).toHaveBeenCalledTimes(1);
    visibility = "hidden"; vi.advanceTimersByTime(120_000); expect(state.refresh).toHaveBeenCalledTimes(1);
    visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); expect(state.refresh).toHaveBeenCalledTimes(2);
    if (cleanup) cleanup(); vi.advanceTimersByTime(120_000); document.dispatchEvent(new Event("visibilitychange"));
    expect(state.refresh).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("fixed simulated mode creates no timer or visibility listener", async () => {
    vi.useFakeTimers(); await render({ mode: "demo", day: "SUN", time: "23:59" });
    expect(state.effects[0]()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0); expect(state.refresh).not.toHaveBeenCalled();
  });
  it("reset to live discards simulation and evaluates fresh server clock", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T05:30:00Z"));
    const demo = await render({ mode: "demo", day: "SUN", time: "23:59" }); expect(demo).toContain("SUN 23:59 EAT");
    const live = await render({ mode: "live", semester: "1" }); expect(live).toContain("Live schedule clock"); expect(live).toContain("MON 08:30 EAT"); expect(live).not.toContain("SUN 23:59 EAT");
  });
});
