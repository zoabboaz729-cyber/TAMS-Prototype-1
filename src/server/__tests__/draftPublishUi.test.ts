/**
 * M4-T3c2 — officer publish-draft UI regression tests.
 *
 * The prototype has no React Testing Library, jsdom or happy-dom and this task adds no dependency, so
 * these tests cover (a) the pure readiness, request and gate helpers the new modules export, (b) the
 * typed result → view decisions, and (c) static server-rendered markup through the already-installed
 * `react-dom/server` (the preserved-JSX components call `React.createElement` through a global, set once
 * below). `/officer/draft` itself is rendered as a server component with the mocks the generate suite
 * already uses.
 *
 * NOT covered here, by construction — do not read these passes as click proof: the pending transition,
 * real navigation, keyboard focus, what Cancel does after a real click, and the two-session publication
 * race. Those are the browser walkthrough recorded in PROGRESS.md for this task.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/domain/permissions";
import type { ValidationOutcome } from "@/domain/validator";
import type { DraftPublishResult } from "@/server/draftPublishContract";

(globalThis as { React?: typeof React }).React = React;

const h = vi.hoisted(() => ({
  drafts: [] as { id: string; semester: number }[],
  load: { ok: true } as unknown,
  /** What the page's guarded published-version read answers. */
  publishedRow: null as null | { id: string; semester: number; status: string; publishedAt: Date | null; _count: { entries: number } },
  versionQueries: [] as { where?: { status?: string } }[],
  publishedQueries: [] as { where?: { id?: string } }[],
  officer: { id: "u-officer", name: "Officer A", email: "officer@example.ac.ke", role: "OFFICER", departmentId: null, studentGroupId: null } as Actor,
}));

vi.mock("@/server/guards", () => ({ requireAction: async () => h.officer }));
vi.mock("@/server/db", () => ({
  prisma: {
    timetableVersion: {
      findMany: async (options: { where?: { status?: string } }) => { h.versionQueries.push(options); return h.drafts; },
      findUnique: async (options: { where?: { id?: string } }) => { h.publishedQueries.push(options); return h.publishedRow; },
    },
    teaching: { findMany: async () => [] },
  },
}));
vi.mock("@/server/draftStorePrisma", () => ({ createDraftValidationStore: () => ({}) }));
vi.mock("@/server/draftValidation", () => ({ loadDraftForValidation: async () => h.load }));
vi.mock("@/server/venueData", () => ({ loadVenueRecords: async () => [] }));
vi.mock("@/app/officer/draft/publishActions", () => ({ publishDraftAction: async () => ({ ok: false, kind: "FORBIDDEN" }) }));
vi.mock("@/app/officer/draft/generateActions", () => ({ generateDraftAction: async () => ({ ok: false, kind: "FORBIDDEN" }) }));
vi.mock("@/app/officer/draft/actions", () => ({ moveDraftEntryAction: async () => ({}), addDraftEntryAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const {
  PUBLISH_ARCHIVE_EXPLANATION, PUBLISH_ELIGIBILITY_NOTE, buildPublishRequest, canConfirmPublish,
  canOpenConfirmation, decidePublishReadiness, describeReadinessSentence, describeRequestState, DraftPublishForm, PublishConfirmationPanel,
} = await import("@/app/officer/draft/DraftPublishForm");
const { describePublishResult, describePublishedPanel, formatPublishedAt, PublishResultPanel, PublishedVersionPanel } = await import("@/app/officer/draft/DraftPublishOutcome");
const { default: draftPage } = await import("@/app/officer/draft/page");

const PUBLISHED_AT = new Date(Date.UTC(2026, 10, 6, 9, 30, 15));
const PUBLISHED_TEXT = "2026-11-06 09:30:15 UTC";
const CLASH_A = "LH1 is already used by two classes at MON 09:00-10:00.";
const CLASH_B = "Room CR3 is too small for 60 students.";
const MISSING_VENUE = "Entry e-4 names a venue that does not exist, so it could not be checked.";

const cleanCheck: ValidationOutcome = { status: "ok", violations: [] };
const clashCheck: ValidationOutcome = { status: "ok", violations: [{ type: "VENUE_OVERLAP", entryId: "e-1", conflictEntryId: "e-2", message: CLASH_A }, { type: "CAPACITY", entryId: "e-3", message: CLASH_B }] };
const missingVenueRow = { kind: "MISSING_VENUE" as const, entryIndex: 0, entryId: "e-4", refId: "v-gone", message: MISSING_VENUE };
const incompleteCheck: ValidationOutcome = { status: "incomplete", violations: [{ type: "CAPACITY", entryId: "e-3", message: CLASH_B }], missingContext: [missingVenueRow] };

type PublishFailure = Exclude<DraftPublishResult, { ok: true }>;

const successResult: DraftPublishResult = { ok: true, versionId: "ver-s1-new", semester: 1, archivedVersionIds: ["ver-s1-old"], publishedAt: PUBLISHED_AT };
const hardViolations: PublishFailure = { ok: false, kind: "HARD_VIOLATIONS", versionId: "ver-s1-planted", violations: clashCheck.violations };
const incompleteFailure: PublishFailure = { ok: false, kind: "INCOMPLETE_VALIDATION", versionId: "ver-s1-planted", violations: [], missingContext: incompleteCheck.missingContext };
const invalidData: PublishFailure = { ok: false, kind: "INVALID_VERSION_DATA", versionId: "ver-weird", reason: "PUBLISHED_AT_ON_DRAFT",
  message: "Version ver-weird is a DRAFT but already carries a publication time, so its state is inconsistent. Check it before publishing." };

/** Every typed refusal kind the accepted result union can carry. */
const failures: PublishFailure[] = [
  { ok: false, kind: "UNAUTHENTICATED" },
  { ok: false, kind: "FORBIDDEN" },
  { ok: false, kind: "INVALID_INPUT", message: "The publication request may only carry the draft version id." },
  { ok: false, kind: "VERSION_NOT_FOUND", versionId: "ver-gone" },
  { ok: false, kind: "NOT_DRAFT", versionId: "ver-s1-old", storedStatus: "ARCHIVED" },
  { ok: false, kind: "EMPTY_DRAFT", versionId: "ver-empty" },
  hardViolations, incompleteFailure, invalidData,
  { ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" }, { ok: false, kind: "INTERNAL_ERROR" },
];

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);
const draftRows = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({
  id: `e-${index}`, unitCode: "SOEN 413", venueId: "v-1", venueCode: "CR1", day: "MON", start: "09:00", end: "10:00", locked: false,
}));

/** The editor branch: one server-loaded DRAFT, its entries and its M3 outcome. */
function draftOnScreen(entryCount = 3, validation: ValidationOutcome = cleanCheck): void {
  h.drafts = [{ id: "ver-s1-planted", semester: 1 }];
  h.load = { ok: true, version: { id: "ver-s1-planted", semester: 1, status: "DRAFT" }, entries: draftRows(entryCount), validation };
  h.publishedRow = null;
}

const renderPage = async (params: Record<string, string> = {}): Promise<string> => render(await draftPage({ searchParams: Promise.resolve(params) }));

const confirmationProps = { versionId: "ver-s1-planted", semester: 1, entryCount: 54, pending: false, onConfirm: () => undefined, onCancel: () => undefined };
const formProps = { versionId: "ver-s1-planted", semester: 1, entryCount: 54, validation: cleanCheck };

beforeEach(() => { h.officer.role = "OFFICER"; h.versionQueries = []; h.publishedQueries = []; });

describe("publication readiness (requirements 1, 2)", () => {
  it("offers publication for an ok check with zero violations and at least one entry", () => {
    expect(decidePublishReadiness(cleanCheck, 54)).toEqual({ state: "eligible", reason: "The latest server-side check of this draft found no hard violations." });
    expect(canOpenConfirmation({ readiness: decidePublishReadiness(cleanCheck, 54), confirming: false, pending: false })).toBe(true);
  });
  it("blocks a draft with hard violations and carries every violation message", () => {
    const readiness = decidePublishReadiness(clashCheck, 54);
    expect(readiness.state).toBe("blocked");
    expect(readiness.reason).toContain("2 hard violations must be cleared");
    expect(readiness.state === "blocked" ? readiness.details : []).toEqual([CLASH_A, CLASH_B]);
    expect(canOpenConfirmation({ readiness, confirming: false, pending: false })).toBe(false);
  });
  it("blocks an incomplete check and shows both the provisional clash and the missing-context detail", () => {
    const readiness = decidePublishReadiness(incompleteCheck, 54);
    expect(readiness.state).toBe("blocked");
    expect(readiness.reason).toContain("Validation could not finish");
    expect(readiness.state === "blocked" ? readiness.details : []).toEqual([CLASH_B, MISSING_VENUE]);
  });
  it("blocks a draft with no entries", () => {
    const readiness = decidePublishReadiness(cleanCheck, 0);
    expect(readiness.state).toBe("blocked");
    expect(readiness.reason).toContain("no entries");
    expect(canOpenConfirmation({ readiness, confirming: true, pending: false })).toBe(false);
  });
  it("never claims eligibility means every weekly session is scheduled", () => {
    expect(PUBLISH_ELIGIBILITY_NOTE).toContain("It does not claim every weekly teaching session is scheduled");
    expect(PUBLISH_ELIGIBILITY_NOTE).toContain("does not enforce that separate completeness policy");
    expect(decidePublishReadiness(cleanCheck, 54).reason).not.toMatch(/complete|every session|all sessions/);
  });
});

describe("the publication panel and its confirmation step (requirements 3, 4, 5)", () => {
  it("names the version, semester, entry count and DRAFT status and states the archiving consequence", () => {
    const html = render(createElement(DraftPublishForm, formProps));
    expect(html).toContain("Publish this draft");
    expect(html).toContain('aria-labelledby="publish-heading"');
    expect(html).toContain(">ver-s1-planted<"); expect(html).toContain("Semester 1"); expect(html).toContain("54 entries"); expect(html).toContain(">DRAFT<"); expect(html).toContain("(editable)");
    expect(html).toContain("Previously published versions for that semester will be archived."); expect(html).toContain(PUBLISH_ARCHIVE_EXPLANATION);
    expect(html).toContain("Publish timetable</button>");
    expect(html).not.toContain("Confirm publication");
  });
  it("is a two-step interaction: step two carries the confirm and cancel buttons", () => {
    const html = render(createElement(PublishConfirmationPanel, confirmationProps));
    expect(html).toContain("Confirm publication"); expect(html).toContain("Cancel");
    expect(html.match(/type="button"/g)?.length).toBe(2);
    expect(html).toContain("version ver-s1-planted of semester 1 (54 entries)");
    expect(html).toContain("Nothing has been published yet.");
    expect(html).toContain(PUBLISH_ARCHIVE_EXPLANATION);
    expect(html).toContain('aria-labelledby="publish-confirm-heading"');
  });
  it("disables both confirmation controls and says Publishing… while a request is in flight", () => {
    const html = render(createElement(PublishConfirmationPanel, { ...confirmationProps, pending: true }));
    expect(html).toContain("Publishing…");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).not.toContain("Nothing has been published yet.");
    expect(html).toContain("the request is running");
  });
  it("submits exactly one field — the server-loaded version id — and nothing else", () => {
    const request = buildPublishRequest("ver-s1-planted");
    expect(request).toEqual({ versionId: "ver-s1-planted" }); expect(Object.keys(request)).toEqual(["versionId"]);
    const forged = ["actorId", "userId", "role", "status", "publishedAt", "semester", "archivedVersionIds", "snapshotFingerprint", "validation", "auditReason"];
    expect(Object.keys(request).filter((key) => forged.includes(key))).toEqual([]);
  });
  it("lets the action run only for an eligible draft in its confirmation step with nothing pending", () => {
    const gates = [
      { readiness: decidePublishReadiness(clashCheck, 54), confirming: true, pending: false },
      { readiness: decidePublishReadiness(cleanCheck, 0), confirming: true, pending: false },
      { readiness: decidePublishReadiness(incompleteCheck, 54), confirming: true, pending: false },
      { readiness: decidePublishReadiness(cleanCheck, 54), confirming: false, pending: false },
      { readiness: decidePublishReadiness(cleanCheck, 54), confirming: true, pending: true },
    ];
    expect(gates.map((gate) => canConfirmPublish(gate))).toEqual([false, false, false, false, false]);
    expect(canConfirmPublish({ readiness: decidePublishReadiness(cleanCheck, 54), confirming: true, pending: false })).toBe(true);
  });
  it("shows the block reason instead of a confirmation entry point for a conflicting draft", () => {
    const html = render(createElement(DraftPublishForm, { ...formProps, validation: clashCheck }));
    expect(html).toContain("Publication is blocked:"); expect(html).toContain(CLASH_A);
    expect(html).toContain(CLASH_B);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("Confirm publication");
  });
  it("says only what the request state and the last server check actually support", () => {
    const clean = decidePublishReadiness(cleanCheck, 54);
    expect([describeRequestState(false, null), describeRequestState(true, hardViolations), describeRequestState(false, successResult)]).toEqual(["No request has been sent yet", "Publication request in progress", expect.stringContaining("committed this publication")]);
    expect(describeRequestState(false, hardViolations)).toContain("was sent and refused — nothing was published");
    expect(describeReadinessSentence(clean, false)).toBe(`${clean.reason} ${PUBLISH_ELIGIBILITY_NOTE}`);
    expect(describeReadinessSentence(clean, true)).toContain("reached a different conclusion — see the refusal below");
    expect(describeReadinessSentence(decidePublishReadiness(clashCheck, 54), true)).toContain("Publication is blocked:");
  });
});

describe("success wording (requirement 6)", () => {
  it("identifies the version published, its semester, the returned timestamp and the ids archived", () => {
    const view = describePublishResult(successResult);
    expect(view.published).toBe(true);
    expect(view.tone).toBe("success");
    expect(view.heading).toContain("ver-s1-new");
    expect(view.heading).toContain("published timetable for semester 1");
    expect(view.facts.join(" ")).toContain(PUBLISHED_TEXT);
    expect(view.facts.join(" ")).toContain("ver-s1-old");
    expect(view.facts.join(" ")).toContain("Previously published and now archived");
    expect(formatPublishedAt(PUBLISHED_AT)).toBe(PUBLISHED_TEXT);
  });
  it("lists several archived ids from the typed result and says so when there are none", () => {
    const two = describePublishResult({ ...successResult, archivedVersionIds: ["ver-a", "ver-b"] });
    expect(two.facts.join(" ")).toContain("ver-a, ver-b");
    const none = describePublishResult({ ...successResult, archivedVersionIds: [] });
    expect(none.facts.join(" ")).toContain("had no earlier published version, so nothing was archived");
  });
  it("never implies the published version is still an editable draft", () => {
    const text = JSON.stringify(describePublishResult(successResult));
    expect(text).toContain("no longer an editable DRAFT");
    expect(text).toContain("Archived versions keep their entries; nothing was deleted.");
    expect(text).not.toMatch(/keep editing it|still editable|edit it as a draft/);
  });
  it("renders success as a status, not an alert", () => {
    const html = render(createElement(PublishResultPanel, { result: successResult }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Version ver-s1-new is now the published timetable");
  });
});

describe("failure wording (requirements 7, 8)", () => {
  it("shows every hard-violation message under its own heading", () => {
    const view = describePublishResult(hardViolations);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.heading).toContain("Hard violations that block publication");
    expect(view.groups[0]?.items).toEqual([CLASH_A, CLASH_B]);
    expect(view.facts.join(" ")).toContain("found 2 hard violations");
  });
  it("shows both the provisional clashes and the missing-context messages for an incomplete check", () => {
    const view = describePublishResult({ ...incompleteFailure, violations: clashCheck.violations.slice(1) });
    expect(view.groups.map((group) => group.heading)).toEqual(["Conflicts found before the checks stopped", "What the checks could not finish"]);
    expect(view.groups.map((group) => group.items.join(" ")).join(" ")).toContain(MISSING_VENUE);
    expect(view.nextStep).toContain("Repair the missing teaching or venue data");
    expect(describePublishResult(incompleteFailure).groups).toHaveLength(1);
    expect(describePublishResult(incompleteFailure).facts[0]).toContain("1 entry is missing the data needed to check it");
    expect(describePublishResult({ ...incompleteFailure, missingContext: [missingVenueRow, missingVenueRow] }).facts[0]).toContain("2 entries are missing the data needed to check them");
  });
  it("explains why an empty draft cannot be published, in its own words", () => {
    const view = describePublishResult({ ok: false, kind: "EMPTY_DRAFT", versionId: "ver-empty" });
    expect(view.heading).toContain("A draft with no entries cannot be published");
    expect(view.facts.join(" ")).toContain("ver-empty contains no timetable entries at all");
    expect(view.nextStep).toContain("would replace the semester's timetable with nothing");
    expect(view.groups).toEqual([]);
  });
  it("tells the officer to reload and review for every stale reason", () => {
    const reasons = ["VERSION_NOT_FOUND", "VERSION_NOT_DRAFT", "SNAPSHOT_CHANGED", "PUBLISHED_SET_CHANGED"] as const;
    const texts = reasons.map((reason) => describePublishResult({ ok: false, kind: "STALE", reason }));
    expect(texts.every((view) => !view.published)).toBe(true);
    expect(texts.map((view) => view.facts[0])).toEqual(["The version disappeared before the write committed.",
      "It was no longer stored as a DRAFT when the transaction ran — another operation may have published or archived it first.",
      "The draft rows, or the teaching, venue, availability or policy data the checks use, changed after the draft was validated.",
      "A different publication changed which versions are current for this semester.",
    ]);
    expect(texts.every((view) => view.nextStep.includes("reloaded") && view.nextStep.includes("publish again"))).toBe(true);
  });
  it("explains NOT_DRAFT and VERSION_NOT_FOUND without guessing a status", () => {
    const notDraft = describePublishResult({ ok: false, kind: "NOT_DRAFT", versionId: "ver-s1-old", storedStatus: "PUBLISHED" });
    expect(notDraft.facts.join(" ")).toContain("ver-s1-old is stored as published, so it cannot be published as a draft");
    expect(notDraft.nextStep).toContain("Another operation may already have published or archived it");
    const gone = describePublishResult({ ok: false, kind: "VERSION_NOT_FOUND", versionId: "ver-gone" });
    expect(gone.facts.join(" ")).toContain("Version ver-gone was not found.");
  });
  it("shows the accepted safe message for inconsistent stored data", () => {
    const view = describePublishResult(invalidData);
    expect(view.facts).toEqual([invalidData.kind === "INVALID_VERSION_DATA" ? invalidData.message : ""]);
    expect(view.published).toBe(false);
  });
  it("gives every typed refusal safe wording that never claims a publication", () => {
    for (const result of failures) {
      const view = describePublishResult(result);
      expect(result.ok, `kind ${result.kind} must never claim success`).toBe(false);
      expect(view.published).toBe(false);
      expect(view.tone).toBe("danger");
      expect(view.heading, `kind ${result.kind}`).toContain("nothing was published");
      expect(view.nextStep.length).toBeGreaterThan(10);
      expect(`${view.heading} ${view.facts.join(" ")}`).not.toMatch(/is now the published timetable|Publication succeeded|is now current/);
    }
  });
  it("renders every failure as an alert with its reasons", () => {
    for (const result of failures) {
      const html = render(createElement(PublishResultPanel, { result }));
      expect(html, `kind ${result.kind}`).toContain('role="alert"');
      expect(html, `kind ${result.kind}`).toContain('aria-live="assertive"');
      expect(html, `kind ${result.kind}`).toContain("nothing was published");
      expect(html).not.toContain('role="status"');
    }
    expect(render(createElement(PublishResultPanel, { result: null }))).toBe("");
  });
  it("renders nothing raw: no database detail, credential, SQL, fingerprint or stack text", () => {
    const panelViews = [
      describePublishedPanel({ kind: "verified", versionId: "v", semester: 1, publishedAt: PUBLISHED_AT, entryCount: 2 }),
      describePublishedPanel({ kind: "other-status", versionId: "v", storedStatus: "ARCHIVED" }),
      describePublishedPanel({ kind: "inconsistent", versionId: "v", reason: "UNREADABLE_STATUS" }),
      describePublishedPanel({ kind: "inconsistent", versionId: "v", reason: "NO_PUBLISHED_AT" }),
      describePublishedPanel({ kind: "absent", versionId: "v" }),
    ];
    const text = [...failures, successResult].map((result) => JSON.stringify(describePublishResult(result))).join(" ") + JSON.stringify(panelViews);
    for (const leak of ["Prisma", "sqlite", "SELECT", "Error:", "at Object.", "hunter2", "postgres://", "connection string", "snapshotFingerprint", "fingerprint"]) {
      expect(text, `no ${leak} in officer-facing wording`).not.toContain(leak);
    }
  });
});

describe("the server-verified published page state (requirement 6)", () => {
  /** The shape the page's guarded read sees; `status` is a plain string in the row. */
  const publishedRow: { id: string; semester: number; status: string; publishedAt: Date | null; _count: { entries: number } } = { id: "ver-s1-new", semester: 1, status: "PUBLISHED", publishedAt: PUBLISHED_AT, _count: { entries: 54 } };
  it("confirms a version the stored row says is PUBLISHED, with what the database holds", async () => {
    draftOnScreen();
    h.publishedRow = publishedRow;
    const html = await renderPage({ published: "ver-s1-new" });
    expect(h.publishedQueries[0]?.where).toEqual({ id: "ver-s1-new" });
    expect(html).toContain('id="published-state-heading"');
    expect(html).toContain("Version ver-s1-new is the published timetable for semester 1.");
    expect(html).toContain(PUBLISHED_TEXT);
    expect(html).toContain("54 entries are stored under this version and were left unchanged");
    expect(html).toContain("stored status is PUBLISHED");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("is not an editable draft (it may be published or archived)");
    expect(html).not.toContain("Publish this draft");
  });
  it("refuses to confirm a forged, absent, non-published or contradictory id", async () => {
    draftOnScreen();
    const rows: (typeof publishedRow | null)[] = [null, { ...publishedRow, status: "ARCHIVED" }, { ...publishedRow, status: "DRAFT" }, { ...publishedRow, status: "PUBLISHD" }, { ...publishedRow, publishedAt: null }];
    for (const row of rows) {
      h.publishedRow = row;
      const html = await renderPage({ published: "ver-s1-new" });
      expect(html, JSON.stringify(row)).not.toContain("is the published timetable for semester");
      expect(html, JSON.stringify(row)).not.toContain(PUBLISHED_TEXT);
      expect(html).toContain("Back to the draft editor");
    }
    // The single mocked read answers whatever id the page asks for, so each
    // wording below is installed together with the row that produced it.
    h.publishedRow = null;
    expect(await renderPage({ published: "ver-forged" })).toContain("was not found");
    h.publishedRow = { ...publishedRow, status: "PUBLISHD" };
    expect(await renderPage({ published: "ver-s1-new" })).toContain("not one this prototype can read");
    h.publishedRow = { ...publishedRow, publishedAt: null };
    expect(await renderPage({ published: "ver-s1-new" })).toContain("carries no publication time");
    h.publishedRow = { ...publishedRow, status: "ARCHIVED" };
    expect(await renderPage({ published: "ver-s1-new" })).toContain("stored as archived, not published");
  });
  it("does not read a published row unless the address asks, and trims what it does ask", async () => {
    draftOnScreen();
    await renderPage({});
    await renderPage({ published: "   " });
    expect(h.publishedQueries).toEqual([]);
    expect(await renderPage({ published: "   " })).toContain("Publish this draft");
    h.publishedRow = publishedRow;
    await renderPage({ published: "  ver-s1-new  " });
    expect(h.publishedQueries[0]?.where).toEqual({ id: "ver-s1-new" });
  });
  it("says plainly what each panel state decides", () => {
    expect(describePublishedPanel({ kind: "verified", versionId: "v-1", semester: 2, publishedAt: PUBLISHED_AT, entryCount: 1 }).tone).toBe("success");
    expect(describePublishedPanel({ kind: "verified", versionId: "v-1", semester: 2, publishedAt: PUBLISHED_AT, entryCount: 1 }).facts.join(" ")).toContain("1 entry is stored");
    expect(describePublishedPanel({ kind: "other-status", versionId: "v-1", storedStatus: "DRAFT" }).facts[0]).toContain("stored as a draft, not published");
    expect(describePublishedPanel({ kind: "absent", versionId: "v-1" }).facts).toEqual(["No publication was confirmed for it."]);
    expect(render(createElement(PublishedVersionPanel, { state: { kind: "absent", versionId: "v-1" } }))).toContain('role="alert"');
  });
});

describe("page integration and preserved M3/M4-T2 behaviour (requirements 1, 9)", () => {
  it("shows publication controls to a session PUBLISH_TIMETABLE allows", async () => {
    draftOnScreen();
    const html = await renderPage();
    expect(html).toContain("Publish this draft");
    expect(html).toContain("Publish timetable</button>");
  });
  it("hides them from a role the permission model refuses, while keeping the editor", async () => {
    draftOnScreen();
    h.officer.role = "DEPT_REP";
    const html = await renderPage();
    expect(html).not.toContain("Publish this draft");
    expect(html).not.toContain("Publish timetable</button>");
    expect(html).toContain("Add a teaching session to version");
  });
  it("offers nothing when the draft failed to load, and blocks it when it holds no entries", async () => {
    h.drafts = [{ id: "ver-s1-planted", semester: 1 }];
    h.load = { ok: false, kind: "NOT_DRAFT", versionId: "ver-s1-planted", storedStatus: "PUBLISHED" };
    const refused = await renderPage();
    expect(refused).not.toContain("Publish this draft");
    expect(refused).toContain("That version is not an editable draft");
    draftOnScreen(0);
    const empty = await renderPage();
    expect(empty).toContain("Publication is blocked: This draft holds no entries");
    expect(empty).toContain("Publish this draft");
    expect(empty).toContain("disabled=\"\"");
  });
  it("keeps the draft-only picker, so a published version disappears from it", async () => {
    h.drafts = [{ id: "ver-s1-keep", semester: 1 }];
    h.load = { ok: true, version: { id: "ver-s1-keep", semester: 1, status: "DRAFT" }, entries: draftRows(2), validation: cleanCheck };
    const html = await renderPage();
    expect(h.versionQueries[0]?.where).toEqual({ status: "DRAFT" });
    expect(html).toContain("ver-s1-keep · semester 1");
    expect(html).not.toContain("ver-s1-new · semester 1");
  });
  it("leaves the generate, add, table and no-drafts states intact", async () => {
    draftOnScreen();
    const html = await renderPage();
    expect(html).toContain("Generate a draft timetable");
    expect(html).toContain('for="generate-semester"');
    expect(html).toContain("Add a teaching session to version");
    expect(html).toContain("Move to");
    expect(html).toContain("No hard violations in this draft.");
    h.drafts = [];
    const empty = await renderPage();
    expect(empty).toContain("No draft version exists yet");
    expect(empty).toContain("Generate draft</button>");
    expect(empty).not.toContain("Publish this draft");
  });
});

describe("the accepted server boundary stays the only door (requirements 1, 4)", () => {
  const read = (name: string): string => readFileSync(join(process.cwd(), "src/app/officer/draft", name), "utf8");
  const sources = ["DraftPublishForm.tsx", "DraftPublishOutcome.tsx", "page.tsx"].map(read);
  const importsOf = (source: string): string => source.split("\n").filter((line) => line.trimStart().startsWith("import")).join("\n");
  it("reaches publication only through publishDraftAction, never the service, store or Prisma", () => {
    for (const source of sources) {
      const imports = importsOf(source);
      expect(imports).not.toMatch(/from "@\/server\/draftPublish"/);
      expect(imports).not.toContain("draftPublishStorePrisma");
      expect(imports).not.toContain("@prisma/client");
      expect(imports).not.toContain("next/headers");
      expect(source).not.toContain("validateEntries(");
    }
    expect(importsOf(sources[0] ?? "")).toContain("@/app/officer/draft/publishActions");
    expect(importsOf(sources[1] ?? "")).not.toContain("publishActions");
  });
  it("hardcodes no role in the client and decides visibility on the server", () => {
    const [form, outcome, page] = sources;
    expect(`${form}${outcome}`).not.toMatch(/"OFFICER"|role ===|actor\.role/);
    expect(page ?? "").toContain('decideAccess(user, "PUBLISH_TIMETABLE")');
    expect(page ?? "").toContain('requireAction("EDIT_DRAFT")');
    expect(`${form}${outcome}${page ?? ""}`).not.toContain("confirm(");
  });
});


describe("M4-T4h D1 current publication navigation", () => {
  it("successful publication offers the current timetable for its semester", () => {
    const result = { ok: true, versionId: "published-s2", semester: 2, archivedVersionIds: [], publishedAt: PUBLISHED_AT } as const;
    const markup = render(createElement(PublishResultPanel, { result: { ...result, archivedVersionIds: [] } }));
    expect(markup).toContain('href="/timetable?semester=2"');
    expect(markup).toContain("View current published timetable");
    expect(markup).not.toContain("later task");
  });
  it("verified publication offers navigation while unverified states never imply publication success", () => {
    const markup = render(createElement(PublishedVersionPanel, { state: { kind: "verified", versionId: "v", semester: 1, publishedAt: PUBLISHED_AT, entryCount: 2 } }));
    expect(markup).toContain('href="/timetable?semester=1"');
    expect(markup).not.toContain("later task");
    const absent = render(createElement(PublishedVersionPanel, { state: { kind: "absent", versionId: "gone" } }));
    expect(absent).not.toContain("View current published timetable");
  });
});
