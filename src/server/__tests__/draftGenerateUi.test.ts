/**
 * M4-T2c2 — generate-draft interface regression tests.
 *
 * The prototype has no React Testing Library, jsdom or happy-dom and this task
 * adds no dependencies, so these tests cover (a) the pure request/outcome
 * decisions exported by the two new modules and (b) static server-rendered
 * markup via the already-installed `react-dom/server`. `jsx: "preserve"` means
 * the compiled components call `React.createElement` through a global, which is
 * set once below.
 *
 * NOT covered here, by construction — do not read these passes as click proof:
 * state changes after an interaction (choosing "from an existing draft",
 * changing the semester, the pending flag, the actual navigation) and the real
 * two-session race. Those need a browser; see the manual check procedure in
 * PROGRESS.md for this task.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/permissions";
import type { DraftGenerateResult } from "@/server/draftGenerateContract";

(globalThis as { React?: typeof React }).React = React;

const h = vi.hoisted(() => ({
  drafts: [] as { id: string; semester: number }[],
  load: { ok: true } as unknown,
  /** Every `timetableVersion.findMany` argument the page made, for scope checks. */
  versionQueries: [] as { where?: { status?: string } }[],
  officer: { id: "u-officer", name: "Officer A", email: "officer@example.ac.ke", role: "OFFICER", departmentId: null, studentGroupId: null } as Actor,
}));

vi.mock("@/server/guards", () => ({ requireAction: async () => h.officer }));
vi.mock("@/server/db", () => ({
  prisma: {
    timetableVersion: {
      findMany: async (options: { where?: { status?: string } }) => {
        h.versionQueries.push(options);
        return h.drafts;
      },
    },
    teaching: { findMany: async () => [] },
  },
}));
vi.mock("@/server/draftStorePrisma", () => ({ createDraftValidationStore: () => ({}) }));
vi.mock("@/server/draftValidation", () => ({ loadDraftForValidation: async () => h.load }));
vi.mock("@/server/venueData", () => ({ loadVenueRecords: async () => [] }));
vi.mock("@/app/officer/draft/generateActions", () => ({
  generateDraftAction: async () => ({ ok: false, kind: "FORBIDDEN" }),
}));
vi.mock("@/app/officer/draft/actions", () => ({
  moveDraftEntryAction: async () => ({}),
  addDraftEntryAction: async () => ({}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const { buildGenerateRequest, eligibleDraftSources, DraftGenerateForm, DraftSourceSelect } =
  await import("@/app/officer/draft/DraftGenerateForm");
const { describeGenerateResult, describeUnplaced, GenerateResultPanel, STEP_LIMIT_NOTE } =
  await import("@/app/officer/draft/DraftGenerateOutcome");
const { default: draftPage } = await import("@/app/officer/draft/page");

const SEED_LAB_MESSAGE = "No venue is a LAB with room for 45 students, so this session cannot be placed.";

/** The seeded semester-1 shape: 51 placeable sessions, three LAB failures. */
const partialResult = {
  ok: false, kind: "PARTIAL_GENERATION", placedCount: 51, softScore: 44,
  unplaced: [
    { kind: "ACTIVITY", activityId: "gen-ta-2", teachingId: "t-a", unitCode: "SOEN 400", reason: "NO_COMPATIBLE_VENUE", message: SEED_LAB_MESSAGE },
    { kind: "ACTIVITY", activityId: "gen-tb-2", teachingId: "t-b", unitCode: "SOEN 407", reason: "NO_COMPATIBLE_VENUE", message: SEED_LAB_MESSAGE },
    { kind: "ACTIVITY", activityId: "gen-tc-2", teachingId: "t-c", unitCode: "SOEN 421", reason: "NO_COMPATIBLE_VENUE", message: SEED_LAB_MESSAGE },
  ],
} satisfies DraftGenerateResult;

type GenerateFailureResult = Exclude<DraftGenerateResult, { ok: true }>;

const failures: GenerateFailureResult[] = [
  { ok: false, kind: "UNAUTHENTICATED" },
  { ok: false, kind: "FORBIDDEN" },
  { ok: false, kind: "INVALID_INPUT", message: "Semester must be 1 or 2." },
  { ok: false, kind: "SOURCE_NOT_FOUND", sourceVersionId: "ver-gone" },
  { ok: false, kind: "SOURCE_NOT_DRAFT", sourceVersionId: "ver-pub", storedStatus: "PUBLISHED" },
  {
    ok: false, kind: "INCOMPLETE_INPUT",
    problems: [
      { kind: "NO_ACTIVE_VENUES", message: "No active venue exists, so nothing could be placed." },
      { kind: "SOURCE_ENTRY_UNRESOLVED", entryId: "e-9", message: "Locked entry e-9 uses a venue that is not active." },
    ],
  },
  partialResult,
  {
    ok: false, kind: "INVALID_GENERATION",
    violations: [{ type: "VENUE_OVERLAP", entryId: "e-1", message: "CR1 is used by two classes at the same time (MON 09:00-10:00)." }],
    missingContext: [{ kind: "MISSING_VENUE", entryIndex: 1, entryId: "e-2", refId: "v-x", message: "Entry e-2 names a venue that does not exist, so it could not be checked." }],
  },
  { ok: false, kind: "STALE", sourceVersionId: "ver-draft" },
  { ok: false, kind: "INTERNAL_ERROR" },
];

const successResult: DraftGenerateResult = { ok: true, versionId: "ver-new-1", entryCount: 54, softScore: 31 };

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

/** The page's editor branch: one DRAFT version that validates cleanly. */
function draftOnScreen(id = "ver-s1-planted"): void {
  h.drafts = [{ id, semester: 1 }];
  h.load = { ok: true, version: { id, semester: 1, status: "DRAFT" }, entries: [], validation: { status: "ok", violations: [] } };
}

const renderPage = async (): Promise<string> => render(await draftPage({ searchParams: Promise.resolve({}) }));

/** The visibility test switches roles; nobody else inherits that choice. */
beforeEach(() => {
  h.officer.role = "OFFICER";
});

describe("generate request payload", () => {
  it("sends a fresh generation with a numeric semester and no source", () => {
    expect(buildGenerateRequest({ semester: "1", mode: "fresh", sourceVersionId: "" })).toEqual({ semester: 1, sourceVersionId: null });
  });

  it("sends semester 2 as the number 2, never the string", () => {
    const request = buildGenerateRequest({ semester: "2", mode: "fresh", sourceVersionId: "" });
    expect(request.semester).toBe(2);
    expect(typeof request.semester).toBe("number");
  });

  it("sends the chosen source draft and carries it as a string id", () => {
    expect(buildGenerateRequest({ semester: "1", mode: "source", sourceVersionId: "ver-draft" })).toEqual({ semester: 1, sourceVersionId: "ver-draft" });
  });

  it("sends no source when the officer has not picked one, and nothing else", () => {
    const request = buildGenerateRequest({ semester: "1", mode: "source", sourceVersionId: "" });
    expect(request).toEqual({ semester: 1, sourceVersionId: null });
    // Requirement 7: the browser may send only these two keys.
    expect(Object.keys(request).sort()).toEqual(["semester", "sourceVersionId"]);
    const forged = ["actorId", "createdBy", "userId", "role", "status", "locked", "softScore", "versionId", "expectedSource"];
    expect(Object.keys(request).filter((key) => forged.includes(key))).toEqual([]);
  });
});

describe("eligible generation sources", () => {
  const sources = [{ id: "ver-s1-draft", semester: 1 }, { id: "ver-s2-draft", semester: 2 }, { id: "ver-s1-second", semester: 1 }];

  it("keeps only drafts in the chosen semester", () => {
    expect(eligibleDraftSources(sources, "2").map((s) => s.id)).toEqual(["ver-s2-draft"]);
    expect(eligibleDraftSources(sources, "1").map((s) => s.id)).toEqual(["ver-s1-draft", "ver-s1-second"]);
  });

  it("offers no source when the semester has none", () => {
    expect(eligibleDraftSources([], "1")).toEqual([]);
  });

  it("renders only same-semester draft options in the picker", () => {
    const html = render(createElement(DraftSourceSelect, { semester: "1", sources, value: "", disabled: false, onChange: () => undefined }));
    expect(html).toContain("ver-s1-draft");
    expect(html).toContain("ver-s1-second");
    expect(html).not.toContain("ver-s2-draft");
    expect(html).toContain('id="generate-source"');
  });

  it("says so when no draft exists in the semester", () => {
    const html = render(createElement(DraftSourceSelect, { semester: "1", sources: [{ id: "ver-s2-draft", semester: 2 }], value: "", disabled: false, onChange: () => undefined }));
    expect(html).toContain("No draft in this semester");
  });
});

/**
 * The page decides generate visibility from `decideAccess` on the server, so
 * the check renders the page the way an officer and a refusal see it (static
 * markup only). The permission matrix itself stays with the accepted
 * permissions tests; a role that cannot pass the page guard never gets here.
 */
describe("generation controls visibility", () => {
  it("renders the controls for the role GENERATE_TIMETABLE allows", async () => {
    draftOnScreen();
    expect(await renderPage()).toContain('for="generate-semester"');
  });

  it("omits them for a role GENERATE_TIMETABLE refuses, in both page states", async () => {
    h.officer.role = "DEPT_REP";
    draftOnScreen();
    expect(await renderPage()).not.toContain('for="generate-semester"');
    h.drafts = [];
    const empty = await renderPage();
    expect(empty).not.toContain('for="generate-semester"');
    expect(empty).toContain("cannot generate");
  });
});

describe("outcome wording", () => {
  it("reports a saved draft only for ok: true, and never as published", () => {
    const view = describeGenerateResult(successResult);
    expect(view.saved).toBe(true);
    expect(view.tone).toBe("success");
    expect(view.heading).toContain("ver-new-1");
    expect(view.facts.join(" ")).toContain("54 entries are saved as a DRAFT");
    expect(view.facts.join(" ")).toContain("not published");
    expect(view.facts.join(" ")).not.toMatch(/has been published|is now published|official approval/);
    expect(view.budgetNote).toBeNull();
  });

  it("marks every failure kind unsaved with a next step", () => {
    for (const result of failures) {
      const view = describeGenerateResult(result);
      expect(result.ok, `kind ${result.kind} must never claim a save`).toBe(false);
      expect(view.saved).toBe(false);
      // Honest unsaved wording, in one of the three fixed phrasings.
      expect(`${view.heading} ${view.facts.join(" ")} ${view.nextStep}`).toMatch(
        /nothing was saved|No draft was saved|No partial draft was written/,
      );
      expect(view.nextStep.length).toBeGreaterThan(10);
    }
  });

  it("names each unplaced session and its plain-language reason", () => {
    const view = describeGenerateResult(partialResult);
    expect(view.unplaced).toHaveLength(3);
    expect(view.unplaced.map((row) => row.subject)).toEqual([
      "Session for SOEN 400 — no venue fits it", "Session for SOEN 407 — no venue fits it", "Session for SOEN 421 — no venue fits it",
    ]);
    expect(view.unplaced.every((row) => row.text === SEED_LAB_MESSAGE)).toBe(true);
    expect(view.unplaced.every((row) => row.fixed)).toBe(false);
    expect(view.heading).toContain("3 items are unresolved");
    expect(view.facts[0]).toContain("51 sessions could be placed");
  });

  it("distinguishes a search-budget cut from a scheduling failure", () => {
    const budget: DraftGenerateResult = {
      ...partialResult,
      unplaced: [
        { kind: "ACTIVITY", activityId: "gen-tz-1", teachingId: "t-z", unitCode: "SOEN 413", reason: "STEP_LIMIT", message: "The search budget ran out before this session was placed." },
      ],
    };
    const view = describeGenerateResult(budget);
    expect(view.budgetNote).toBe(STEP_LIMIT_NOTE);
    expect(view.budgetNote).toContain("not proven impossible");
    expect(view.unplaced[0]?.reason).toBe("STEP_LIMIT");
    expect(describeGenerateResult(partialResult).budgetNote).toBeNull();
  });

  it("identifies a fixed-entry problem as a locked-row issue", () => {
    const row = describeUnplaced({ kind: "FIXED", entryId: "e-lock-1", teachingId: "t-a", reason: "FIXED_CONFLICT", message: "Locked entry e-lock-1 clashes with a generated session." });
    expect(row.fixed).toBe(true);
    expect(row.subject).toContain("Locked entry e-lock-1");
    expect(row.subject).toContain("conflicts with the new board");
    const unresolved = describeUnplaced({ kind: "FIXED", entryId: "e-lock-2", teachingId: "t-b", reason: "FIXED_UNRESOLVED", message: "Locked entry e-lock-2 names a venue that is not active." });
    expect(unresolved.subject).toContain("could not be kept");
  });

  it("shows the counted locked-row problems separately from unplaced sessions", () => {
    const view = describeGenerateResult({
      ...partialResult,
      unplaced: [...partialResult.unplaced, { kind: "FIXED", entryId: "e-lock-1", teachingId: "t-a", reason: "FIXED_CONFLICT", message: "Locked entry e-lock-1 clashes with a generated session." }],
    });
    expect(view.facts[1]).toContain("3 required sessions could not be scheduled");
    expect(view.facts[2]).toContain("1 locked entry needs attention");
  });

  it("lists every INCOMPLETE_INPUT problem message", () => {
    const view = describeGenerateResult(failures[5]);
    expect(view.facts).toHaveLength(2);
    expect(view.facts.join(" ")).toContain("No active venue exists");
    expect(view.facts.join(" ")).toContain("Locked entry e-9");
  });

  it("shows INVALID_GENERATION violations and the missing-context advice", () => {
    const view = describeGenerateResult(failures[7]);
    expect(view.facts.join(" ")).toContain("CR1 is used by two classes at the same time");
    expect(view.facts.join(" ")).toContain("Entry e-2 names a venue that does not exist");
    expect(view.nextStep).toContain("repair that data first");
    const clashOnly = describeGenerateResult({
      ok: false, kind: "INVALID_GENERATION", missingContext: [],
      violations: [{ type: "CAPACITY", entryId: "e-1", message: "Room CR3 is too small for 60 students." }],
    });
    expect(clashOnly.nextStep).toContain("generate again");
    expect(clashOnly.nextStep).not.toContain("repair that data");
  });

  it("tells the officer to reload the options on STALE, with or without a source", () => {
    const view = describeGenerateResult(failures[8]);
    expect(view.facts[0]).toContain("ver-draft");
    expect(view.nextStep).toContain("reloaded");
    const fresh = describeGenerateResult({ ok: false, kind: "STALE", sourceVersionId: null });
    expect(fresh.facts[0]).toContain("without a source");
  });

  it("refuses to leak internals into any message", () => {
    const text = [...failures, successResult]
      .map((result) => JSON.stringify(describeGenerateResult(result))).join(" ");
    for (const leak of ["Prisma", "sqlite", "SELECT", "at Object.", "Error:", "connection string"]) {
      expect(text, `no ${leak} in officer-facing wording`).not.toContain(leak);
    }
  });
});

describe("rendered outcome panel", () => {
  it("renders the partial result as an alert with a scrollable reason list", () => {
    const html = render(createElement(GenerateResultPanel, { result: partialResult }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("No draft was saved");
    expect(html).toContain("SOEN 421");
    expect(html).toContain(SEED_LAB_MESSAGE.replace(/&/g, "&amp;"));
    expect(html).toContain("overflow-y-auto");
    expect(html.match(/Session for /g)?.length).toBe(3);
  });

  it("renders a saved draft as a status, naming the new version", () => {
    const html = render(createElement(GenerateResultPanel, { result: successResult }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Draft version ver-new-1 was created");
    expect(html).not.toContain("alert");
  });

  it("renders a typed refusal for every failure kind", () => {
    for (const result of failures) {
      const html = render(createElement(GenerateResultPanel, { result }));
      expect(html, `kind ${result.kind}`).toMatch(
        /nothing was saved|No draft was saved|No partial draft was written/,
      );
      expect(html).toContain('aria-labelledby="generate-outcome-heading"');
    }
  });
});

describe("rendered generate form", () => {
  it("labels every control and offers both source modes", () => {
    const html = render(
      createElement(DraftGenerateForm, {
        sources: [{ id: "ver-draft", semester: 1 }],
        defaultSemester: 1,
      }),
    );
    expect(html).toContain("Generate a draft timetable");
    expect(html).toContain('for="generate-semester"');
    expect(html).toContain("Locked rows to keep</legend>");
    expect(html).toContain("Fresh draft");
    expect(html).toContain("keep its locked entries");
    expect(html).toContain("Generate draft</button>");
    expect(html).not.toContain("Generating…");
    expect(html).toContain('type="submit"');
    expect(html).toContain('<label for="generate-semester" class=');
  });

  it("starts in fresh mode and offers no result panel until a request runs", () => {
    const html = render(
      createElement(DraftGenerateForm, { sources: [{ id: "ver-draft", semester: 1 }], defaultSemester: 2 }),
    );
    // Semester 2 is not the seeded default fallback either: 2 is a valid choice.
    expect(html).toContain('value="2" selected');
    expect(html).not.toContain('id="generate-source"');
    expect(html).not.toContain("generate-outcome-heading");
  });
});

describe("page states", () => {
  beforeEach(() => {
    h.drafts = [];
    h.versionQueries = [];
    h.load = { ok: false, kind: "NOT_FOUND" };
  });

  it("reads its draft list with a DRAFT-only scope, so no published or archived version can be offered as a source", async () => {
    draftOnScreen();
    await renderPage();
    expect(h.versionQueries).toHaveLength(1);
    expect(h.versionQueries[0]?.where).toEqual({ status: "DRAFT" });
  });

  it("still renders the generation controls when no draft exists", async () => {
    const html = await renderPage();
    expect(html).toContain("No draft version exists yet");
    expect(html).toContain("Generate a draft timetable");
    expect(html).toContain("Generate draft</button>");
    expect(html).not.toContain("Not implemented in prototype");
    expect(html).not.toContain("Draft version</label>");
    expect(html).not.toContain("Add a teaching session to version");
  });

  it("keeps the picker and editor available when a draft exists", async () => {
    draftOnScreen();
    const html = await renderPage();
    expect(html).toContain("Generate a draft timetable");
    expect(html).toContain('for="draft-version"');
    expect(html).toContain("ver-s1-planted");
    expect(html).toContain("Add a teaching session to version");
  });
});
