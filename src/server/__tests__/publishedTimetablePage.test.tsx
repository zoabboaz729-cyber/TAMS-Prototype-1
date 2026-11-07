/**
 * M4-T4d2 — /timetable page integration tests.
 *
 * No React Testing Library, jsdom or happy-dom is installed and this task adds no
 * dependency, so the page is exercised through the already-installed react-dom/server:
 * the async server component is awaited to its element tree, then rendered to static
 * markup (the preserved-JSX children call React.createElement through a global set once
 * below). Only three boundaries are mocked — the guard, the Prisma store factory (so no
 * database is ever loaded) and a grid override used solely to force INVALID_POLICY, which
 * the valid DEFAULT_POLICY can never produce. The real service, grid, renderer and
 * selectors run, so this is a faithful integration of the four accepted components.
 *
 * NOT covered, by construction — do not read these passes as browser proof: real client
 * navigation, GET form submission, keyboard focus, CSS geometry and small-screen layout.
 * Those belong to the later live walkthrough. Static markup proves structure and content,
 * not interaction.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeUser } from "@/server/auth";
import type { PublishedWeekGridResult } from "@/domain/publishedWeekGrid";
import type {
  LecturerChoice,
  PublishedEntriesRead,
  PublishedEntryRow,
  PublishedTimetableStore,
  PublishedVersionRow,
  StudentGroupChoice,
  VenueChoice,
} from "@/server/publishedTimetableContract";

(globalThis as { React?: typeof React }).React = React;

// --- Fixtures (mirror the accepted service suite) -------------------------

const PUB = "ver-pub-s1";
const PUB_AT = new Date("2026-11-06T08:00:00.000Z");
const PUB_TEXT = "2026-11-06 08:00:00 UTC";

const officerUser = (): SafeUser => ({ id: "user-officer", name: "Officer A", email: "officer@example.ac.ke", role: "OFFICER", departmentId: null, studentGroupId: null });
const studentUser = (groupId: string | null = "group-1"): SafeUser => ({ id: "user-student", name: "Student A", email: "student@example.ac.ke", role: "STUDENT", departmentId: null, studentGroupId: groupId });
const lecturerUser = (userId = "user-lect-A"): SafeUser => ({ id: userId, name: "Lecturer A", email: "lect@example.ac.ke", role: "LECTURER", departmentId: "dept-1", studentGroupId: null });

const versionOf = (over: Partial<PublishedVersionRow> = {}): PublishedVersionRow => ({ id: PUB, semester: 1, status: "PUBLISHED", publishedAt: PUB_AT, ...over });
const entryOf = (id: string, over: Partial<PublishedEntryRow> = {}): PublishedEntryRow => ({
  id, versionId: PUB, teachingId: `t-${id}`, venueId: "v-1", day: "MON", start: "08:00", end: "09:00",
  unitCode: "SOEN 413", unitTitle: "Software Architecture", groupId: "group-1", groupName: "SE-Y4",
  lecturerId: "lect-A", lecturerName: "Lecturer A", venueCode: "CR1", ...over,
});

type FakeData = { versions: PublishedVersionRow[]; entries: PublishedEntryRow[]; groups: StudentGroupChoice[]; lecturers: LecturerChoice[]; venues: VenueChoice[] };

/** group-1:{e-1,e-3} group-2:{e-2,e-4} lect-A:{e-1,e-4} lect-B:{e-2,e-3} v-1:{e-1,e-3} v-2:{e-2,e-4}. */
const baseData = (): FakeData => ({
  versions: [versionOf(), versionOf({ id: "ver-pub-s2", semester: 2, publishedAt: new Date("2026-01-06T08:00:00.000Z") })],
  entries: [
    entryOf("e-1"),
    entryOf("e-2", { venueId: "v-2", day: "TUE", unitCode: "CS 201", unitTitle: "Data Structures", groupId: "group-2", groupName: "CS-Y2", lecturerId: "lect-B", lecturerName: "Lecturer B", venueCode: "CR2" }),
    entryOf("e-3", { day: "WED", start: "10:00", end: "11:00", unitCode: "SOEN 415", unitTitle: "Interactive Design", lecturerId: "lect-B", lecturerName: "Lecturer B" }),
    entryOf("e-4", { venueId: "v-2", day: "MON", start: "10:00", end: "11:00", unitCode: "CS 202", unitTitle: "Algorithms", groupId: "group-2", groupName: "CS-Y2", venueCode: "CR2" }),
  ],
  groups: [{ id: "group-1", name: "SE-Y4" }, { id: "group-2", name: "CS-Y2" }],
  lecturers: [{ id: "lect-A", userId: "user-lect-A", displayName: "Lecturer A" }, { id: "lect-B", userId: "user-lect-B", displayName: "Lecturer B" }],
  venues: [{ id: "v-1", code: "CR1" }, { id: "v-2", code: "CR2" }],
});

type FakeOptions = { race?: (data: FakeData) => void; throwOn?: keyof PublishedTimetableStore; throwMessage?: string };
type FakeStore = PublishedTimetableStore & { calls: string[]; data: FakeData };

function makeStore(build?: (data: FakeData) => void, options: FakeOptions = {}): FakeStore {
  const data = baseData();
  build?.(data);
  const store: FakeStore = {
    calls: [], data,
    listPublishedVersionsBySemester: async (semester) => { gate("listPublishedVersionsBySemester"); return data.versions.filter((v) => v.status === "PUBLISHED" && v.semester === semester); },
    readPublishedEntries: async (versionId, semester): Promise<PublishedEntriesRead> => {
      gate("readPublishedEntries");
      options.race?.(data);
      const current = data.versions.filter((v) => v.status === "PUBLISHED" && v.semester === semester && v.publishedAt !== null);
      if (current.length !== 1 || current[0].id !== versionId) return { status: "stale" };
      return { status: "current", version: current[0], entries: data.entries.filter((e) => e.versionId === versionId) };
    },
    listStudentGroups: async () => { gate("listStudentGroups"); return data.groups; },
    listLecturers: async () => { gate("listLecturers"); return data.lecturers; },
    findLecturerByUserId: async (userId) => { gate("findLecturerByUserId"); return data.lecturers.find((l) => l.userId === userId) ?? null; },
    listVenues: async () => { gate("listVenues"); return data.venues; },
  };
  return store;
  function gate(name: keyof PublishedTimetableStore) { store.calls.push(name); if (options.throwOn === name) throw new Error(options.throwMessage ?? "store down"); }
}

// --- Hoisted boundary state and mocks -------------------------------------

const h = vi.hoisted(() => {
  class RedirectError extends Error {
    constructor(readonly path: string) { super(`NEXT_REDIRECT:${path}`); }
  }
  return {
    RedirectError,
    guardMode: "allow" as "allow" | "login" | "forbidden",
    guardCalls: 0,
    storeCalls: 0,
    order: [] as string[],
    user: { id: "user-officer", name: "Officer A", email: "officer@example.ac.ke", role: "OFFICER", departmentId: null, studentGroupId: null } as SafeUser,
    store: null as unknown as PublishedTimetableStore,
    gridOverride: null as PublishedWeekGridResult | null,
  };
});

vi.mock("@/server/guards", () => ({
  requireAction: async () => {
    h.guardCalls += 1;
    h.order.push("guard");
    if (h.guardMode === "login") throw new h.RedirectError("/login");
    if (h.guardMode === "forbidden") throw new h.RedirectError("/forbidden");
    return h.user;
  },
}));

// The factory is mocked so the real adapter (and therefore Prisma/db) never loads.
vi.mock("@/server/publishedTimetableStorePrisma", () => ({
  createPublishedTimetableStore: () => { h.storeCalls += 1; h.order.push("store"); return h.store; },
}));

// Delegate to the real engine except when a test forces the unreachable INVALID_POLICY.
vi.mock("@/domain/publishedWeekGrid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/publishedWeekGrid")>();
  return {
    ...actual,
    buildPublishedWeekGrid: (...args: Parameters<typeof actual.buildPublishedWeekGrid>) =>
      h.gridOverride ?? actual.buildPublishedWeekGrid(...args),
  };
});

const { default: timetablePage } = await import("@/app/timetable/page");

const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const renderPage = async (params: Record<string, string | string[]> = {}): Promise<string> =>
  renderToStaticMarkup(await timetablePage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  consoleSpy.mockClear();
  h.guardMode = "allow";
  h.guardCalls = 0;
  h.storeCalls = 0;
  h.order = [];
  h.gridOverride = null;
  h.user = officerUser();
  h.store = makeStore();
});
afterAll(() => { consoleSpy.mockRestore(); });

// --- 1, 2, 3: the guard runs before any store read ------------------------

describe("authorization boundary", () => {
  it("1. decides VIEW_TIMETABLE before creating the store", async () => {
    const markup = await renderPage({});
    expect(h.guardCalls).toBe(1);
    expect(h.storeCalls).toBe(1);
    expect(h.order[0]).toBe("guard");
    expect(h.order[1]).toBe("store");
    expect(markup).toContain("Publication details");
  });
  it("2. redirects an absent session to /login and never creates a store", async () => {
    h.guardMode = "login";
    await expect(timetablePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.guardCalls).toBe(1);
    expect(h.storeCalls).toBe(0);
  });
  it("3. redirects a forbidden caller to /forbidden and never creates a store", async () => {
    h.guardMode = "forbidden";
    await expect(timetablePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/forbidden");
    expect(h.storeCalls).toBe(0);
  });
});

// --- 4, 5, 6, 7, 35: role-aware defaults ----------------------------------

describe("role-aware defaults", () => {
  it("4. defaults a student to their own session group", async () => {
    h.user = studentUser("group-1");
    const markup = await renderPage({});
    expect(markup).toContain("Publication details");
    expect(markup).toContain('data-entry-id="e-1"');
    expect(markup).toContain('data-entry-id="e-3"');
    expect(markup).not.toContain('data-entry-id="e-2"');
    expect(markup).toContain("SE-Y4");
  });
  it("5. defaults a lecturer to their own Lecturer record", async () => {
    h.user = lecturerUser("user-lect-A");
    const markup = await renderPage({});
    expect(markup).toContain('data-entry-id="e-1"');
    expect(markup).toContain('data-entry-id="e-4"');
    expect(markup).not.toContain('data-entry-id="e-2"');
    expect(markup).toContain("Lecturer view");
  });
  it("6. gives an officer the deterministic first group regardless of store order", async () => {
    h.store = makeStore((d) => { d.groups = [{ id: "group-2", name: "CS-Y2" }, { id: "group-1", name: "SE-Y4" }]; });
    const markup = await renderPage({});
    expect(markup).toContain('data-entry-id="e-1"');
    expect(markup).toContain('data-entry-id="e-3"');
    expect(markup).toContain("SE-Y4");
  });
  it("7. authorizes admin, dept-rep and approver defaults", async () => {
    for (const role of ["ADMIN", "DEPT_REP", "APPROVER"] as const) {
      h.user = { ...officerUser(), role };
      h.store = makeStore();
      const markup = await renderPage({});
      expect(markup).toContain("Publication details");
      expect(markup).toContain("SE-Y4");
    }
  });
  it("35. preserves the role default with no selector in the URL", async () => {
    h.user = studentUser("group-1");
    const markup = await renderPage({});
    expect(markup).toContain('data-entry-id="e-1"');
    expect(markup).toContain("SE-Y4");
    expect(markup).toContain("(selected)");
    expect(markup).toContain("Selected perspective:");
  });
});

// --- 8 through 14: untrusted URL parsing ----------------------------------

describe("URL parsing and validation", () => {
  it("8. parses semester 1", async () => {
    const markup = await renderPage({ semester: "1" });
    expect(markup).toContain("Semester 1");
    expect(markup).toContain(PUB);
  });
  it("9. parses semester 2 and resolves that semester's version", async () => {
    const markup = await renderPage({ semester: "2" });
    expect(markup).toContain("Semester 2");
    expect(markup).toContain("ver-pub-s2");
  });
  it("10. rejects an invalid semester without coercing it to 1", async () => {
    const markup = await renderPage({ semester: "3" });
    expect(markup).toContain("Invalid timetable request");
    expect(markup).toContain("Invalid semester");
    expect(markup).toContain("Choose semester 1 or 2");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("11. rejects a duplicate semester", async () => {
    const markup = await renderPage({ semester: ["1", "2"] });
    expect(markup).toContain("Semester was supplied more than once");
    expect(markup).not.toContain("Publication details");
  });
  it("12. rejects an invalid perspective", async () => {
    const markup = await renderPage({ view: "room", id: "v-1" });
    expect(markup).toContain("Invalid perspective");
    expect(markup).toContain("Choose group, lecturer or venue");
    expect(markup).not.toContain("Publication details");
  });
  it("13. rejects a duplicate perspective", async () => {
    const markup = await renderPage({ view: ["group", "lecturer"], id: "group-1" });
    expect(markup).toContain("View was supplied more than once");
    expect(markup).not.toContain("Publication details");
  });
  it("14. rejects an id supplied without a view", async () => {
    const markup = await renderPage({ id: "group-1" });
    expect(markup).toContain("without a view");
    expect(markup).not.toContain("Publication details");
  });
});

// --- 15, 16, 17, 18: explicit selection -----------------------------------

describe("explicit selection", () => {
  it("15. resolves an explicit group", async () => {
    const markup = await renderPage({ view: "group", id: "group-2" });
    expect(markup).toContain("CS-Y2");
    expect(markup).toContain('data-entry-id="e-2"');
    expect(markup).toContain('data-entry-id="e-4"');
    expect(markup).not.toContain('data-entry-id="e-1"');
  });
  it("16. resolves an explicit lecturer", async () => {
    const markup = await renderPage({ view: "lecturer", id: "lect-B" });
    expect(markup).toContain("Lecturer B");
    expect(markup).toContain('data-entry-id="e-2"');
    expect(markup).toContain('data-entry-id="e-3"');
  });
  it("17. resolves an explicit venue", async () => {
    const markup = await renderPage({ view: "venue", id: "v-2" });
    expect(markup).toContain("CR2");
    expect(markup).toContain("Venue view");
    expect(markup).toContain('data-entry-id="e-2"');
    expect(markup).toContain('data-entry-id="e-4"');
  });
  it("18. reports a nonexistent selection safely", async () => {
    const markup = await renderPage({ view: "group", id: "ghost" });
    expect(markup).toContain("Selection not found");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
});

// --- 19, 20: publication metadata -----------------------------------------

describe("publication metadata", () => {
  it("19. renders semester, perspective, selection, version id and session count", async () => {
    const markup = await renderPage({});
    expect(markup).toContain("Publication details");
    expect(markup).toContain(PUB);
    expect(markup).toContain("Semester 1");
    expect(markup).toContain("Student group");
    expect(markup).toContain("SE-Y4");
    expect(markup).toContain("2 sessions");
    expect(markup).toContain("does not certify that it is conflict-free");
  });
  it("20. labels a deterministic server-derived UTC publication time", async () => {
    const markup = await renderPage({});
    expect(markup).toContain(PUB_TEXT);
    expect(markup).toContain("Published (server time, UTC)");
  });
});

// --- 21 through 27: typed service and grid failures -----------------------

describe("typed failure handling", () => {
  it("21. reports no published version honestly, not as no classes", async () => {
    h.store = makeStore((d) => { d.versions = [versionOf({ id: "ver-pub-s2", semester: 2 })]; });
    const markup = await renderPage({});
    expect(markup).toContain("No published timetable");
    expect(markup).toContain("does not mean there are no classes");
    expect(markup).not.toContain("Publication details");
  });
  it("22. refuses to choose a winner between multiple published versions", async () => {
    h.store = makeStore((d) => { d.versions = [...d.versions, versionOf({ id: "ver-rival", publishedAt: new Date("2026-11-07T08:00:00.000Z") })]; });
    const markup = await renderPage({});
    expect(markup).toContain("More than one published version");
    expect(markup).toContain("will not choose one for you");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("23. never renders previous entries when the read is STALE", async () => {
    h.store = makeStore(undefined, { race: (d) => { const prev = d.versions.find((v) => v.id === PUB); if (prev) prev.status = "ARCHIVED"; d.versions.push(versionOf({ id: "ver-new", publishedAt: new Date("2026-11-07T09:00:00.000Z") })); } });
    const markup = await renderPage({});
    expect(markup).toContain("The published timetable changed");
    expect(markup).toContain("No outdated entries are shown");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("24. fails closed on incomplete published data", async () => {
    h.store = makeStore((d) => { const e = d.entries.find((x) => x.id === "e-1"); if (e) e.unitCode = null; });
    const markup = await renderPage({ view: "group", id: "group-1" });
    expect(markup).toContain("Published data is incomplete");
    expect(markup).toContain("missing required");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("25. shows a data-quality failure for a grid INVALID_ENTRY, no partial timetable", async () => {
    h.store = makeStore((d) => { const e = d.entries.find((x) => x.id === "e-1"); if (e) { e.start = "08:30"; e.end = "09:30"; } });
    const markup = await renderPage({ view: "group", id: "group-1" });
    expect(markup).toContain("Published timetable has an invalid session");
    expect(markup).toContain("e-1");
    expect(markup).toContain("No partial timetable is shown");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("26. shows a data-quality failure for a grid INVALID_POLICY", async () => {
    h.gridOverride = { ok: false, kind: "INVALID_POLICY", property: "slotStart", message: "slotStart must be hour-aligned; the grid renders whole-hour slots only." };
    const markup = await renderPage({});
    expect(markup).toContain("Timetable display policy is invalid");
    expect(markup).toContain("No partial timetable is shown");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
  });
  it("27. renders an empty grid for an existing selection with zero sessions", async () => {
    h.store = makeStore((d) => { d.entries = d.entries.filter((e) => e.groupId !== "group-2"); });
    const markup = await renderPage({ view: "group", id: "group-2" });
    expect(markup).toContain("Publication details");
    expect(markup).toContain("This selected timetable contains no sessions.");
    expect(markup).toContain("0 sessions");
    expect(markup).not.toContain("Selection not found");
    expect(markup).not.toContain("data-entry-id");
  });
});

// --- 28, 29, 30: every perspective uses the accepted renderer -------------

describe("renderer per perspective", () => {
  it("28. renders the group view through PublishedWeekTable", async () => {
    expect(await renderPage({ view: "group", id: "group-1" })).toContain("Published weekly timetable — Student group view");
  });
  it("29. renders the lecturer view through PublishedWeekTable", async () => {
    expect(await renderPage({ view: "lecturer", id: "lect-A" })).toContain("Published weekly timetable — Lecturer view");
  });
  it("30. renders the venue view through PublishedWeekTable", async () => {
    expect(await renderPage({ view: "venue", id: "v-1" })).toContain("Published weekly timetable — Venue view");
  });
});

// --- 31, 32: selector options and selector failure ------------------------

describe("selectors", () => {
  it("31. offers real stored ids and labels, never invented ones", async () => {
    const markup = await renderPage({});
    for (const [value, label] of [["group-1", "SE-Y4"], ["group-2", "CS-Y2"], ["lect-A", "Lecturer A"], ["lect-B", "Lecturer B"], ["v-1", "CR1"], ["v-2", "CR2"]]) {
      expect(markup).toContain(`value="${value}"`);
      expect(markup).toContain(label);
    }
    expect(markup).toContain('name="semester"');
    expect(markup).toContain('name="view"');
    expect(markup).toContain('name="id"');
    expect(markup).not.toContain('name="versionId"');
  });
  it("32. treats a selector read failure as an operational error, not an empty list", async () => {
    h.store = makeStore(undefined, { throwOn: "listStudentGroups" });
    const markup = await renderPage({});
    expect(markup).toContain("Timetable options are unavailable");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Publication details");
    expect(markup).not.toContain("data-entry-id");
    expect(consoleSpy.mock.calls).toEqual([["[timetable] selector options unavailable; rendering operational error"]]);
  });
});

// --- 33, 34: read-only guarantee and no secret leakage --------------------

describe("read-only and leakage guarantees", () => {
  it("33. exposes no mutation, publication or generation control", async () => {
    const markup = await renderPage({});
    expect(markup).not.toContain('method="post"');
    expect(markup).not.toContain('name="versionId"');
    expect(markup).not.toContain("/api/");
    expect((markup.match(/<form/g) ?? []).length).toBe((markup.match(/method="get"/g) ?? []).length);
    for (const label of ["Generate draft", "Publish draft", "Add session", "Move entry", "Delete", "Reschedule", "Archive", "Confirm publication"]) {
      expect(markup).not.toContain(label);
    }
  });
  it("34. keeps raw database errors and credentials out of the markup and log", async () => {
    const secret = "postgres://tams:hunter2@db.internal:5432/tams";
    h.store = makeStore(undefined, { throwOn: "listPublishedVersionsBySemester", throwMessage: `SELECT * FROM TimetableVersion; ${secret}` });
    const markup = await renderPage({});
    expect(markup).toContain("The timetable could not be loaded");
    expect(markup).not.toContain(secret);
    expect(markup).not.toContain("hunter2");
    expect(markup).not.toContain("db.internal");
    expect(markup).not.toContain("SELECT * FROM");
    expect(consoleSpy.mock.calls).toEqual([["[publishedTimetable] read failed; returning INTERNAL_ERROR"]]);
  });
});

// --- 36: the accepted modules are untouched -------------------------------

describe("accepted module integrity", () => {
  it("36. leaves the accepted service, adapter, grid and renderer API intact", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const service = read("src/server/publishedTimetable.ts");
    expect(service).toContain("export async function readPublishedTimetable(");
    expect(service).toContain("[publishedTimetable] read failed; returning INTERNAL_ERROR");
    expect(read("src/server/publishedTimetableStorePrisma.ts")).toContain("export function createPublishedTimetableStore(");
    expect(read("src/domain/publishedWeekGrid.ts")).toContain("export function buildPublishedWeekGrid(");
    const renderer = read("src/app/timetable/PublishedWeekTable.tsx");
    expect(renderer).toContain("export function PublishedWeekTable(");
    expect(renderer).toContain("Prototype — sample data. Not official university records.");
  });
});