/**
 * M4-T3c2a — refusal-kind wording for the readiness sentence. Pure-helper contracts plus
 * one static render (the frozen suite's React-global pattern; no new dependency). The frozen
 * draftPublishUi.test.ts is unedited; its boolean assertion is re-proven as the legacy contract.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ValidationOutcome } from "@/domain/validator";
import type { DraftPublishResult } from "@/server/draftPublishContract";

(globalThis as { React?: typeof React }).React = React;
vi.mock("@/app/officer/draft/publishActions", () => ({ publishDraftAction: async () => ({ ok: false, kind: "FORBIDDEN" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const {
  PUBLISH_ELIGIBILITY_NOTE, buildPublishRequest, canConfirmPublish, canOpenConfirmation,
  decidePublishReadiness, describeReadinessSentence, describeRequestState, DraftPublishForm,
} = await import("@/app/officer/draft/DraftPublishForm");

type PublishFailure = Exclude<DraftPublishResult, { ok: true }>;
const cleanCheck: ValidationOutcome = { status: "ok", violations: [] };
const clashCheck: ValidationOutcome = { status: "ok", violations: [{ type: "VENUE_OVERLAP", entryId: "e-1", conflictEntryId: "e-2", message: "LH1 is already used by two classes at MON 09:00-10:00." }] };
const incompleteCheck: ValidationOutcome = { status: "incomplete", violations: [], missingContext: [{ kind: "MISSING_VENUE", entryIndex: 0, entryId: "e-4", refId: "v-gone", message: "Entry e-4 names a venue that does not exist." }] };
const eligible = decidePublishReadiness(cleanCheck, 54);
const eligibleSentence = `${eligible.reason} ${PUBLISH_ELIGIBILITY_NOTE}`;
const success: DraftPublishResult = { ok: true, versionId: "ver-new", semester: 1, archivedVersionIds: [], publishedAt: new Date(Date.UTC(2026, 10, 6, 9, 30, 15)) };

/** Every typed refusal kind, keyed so a missing kind fails the type check. */
const failures = {
  UNAUTHENTICATED: { ok: false, kind: "UNAUTHENTICATED" },
  FORBIDDEN: { ok: false, kind: "FORBIDDEN" },
  INVALID_INPUT: { ok: false, kind: "INVALID_INPUT", message: "The publication request may only carry the draft version id." },
  VERSION_NOT_FOUND: { ok: false, kind: "VERSION_NOT_FOUND", versionId: "ver-gone" },
  NOT_DRAFT: { ok: false, kind: "NOT_DRAFT", versionId: "ver-old", storedStatus: "ARCHIVED" },
  EMPTY_DRAFT: { ok: false, kind: "EMPTY_DRAFT", versionId: "ver-empty" },
  HARD_VIOLATIONS: { ok: false, kind: "HARD_VIOLATIONS", versionId: "ver-x", violations: clashCheck.violations },
  INCOMPLETE_VALIDATION: { ok: false, kind: "INCOMPLETE_VALIDATION", versionId: "ver-x", violations: [], missingContext: incompleteCheck.missingContext },
  INVALID_VERSION_DATA: { ok: false, kind: "INVALID_VERSION_DATA", versionId: "ver-weird", reason: "PUBLISHED_AT_ON_DRAFT", message: "Version ver-weird is a DRAFT but already carries a publication time." },
  STALE: { ok: false, kind: "STALE", reason: "SNAPSHOT_CHANGED" },
  INTERNAL_ERROR: { ok: false, kind: "INTERNAL_ERROR" },
} satisfies Record<PublishFailure["kind"], PublishFailure>;
const allFailures = Object.values(failures);
const DISAGREEMENT = "reached a different conclusion";
const FINAL_CHECK = "The final publication check";

describe("no failure and success keep the normal eligibility statement (1, 11)", () => {
  it("an eligible draft with no request says exactly the loaded M3 outcome", () => {
    expect(describeReadinessSentence(eligible, null)).toBe(eligibleSentence); expect(describeReadinessSentence(eligible, false)).toBe(eligibleSentence);
  });
  it("a committed success never displays refusal wording", () => {
    expect(describeReadinessSentence(eligible, success)).toBe(eligibleSentence); expect(describeReadinessSentence(eligible, success)).not.toContain(DISAGREEMENT);
  });
});

describe("the two final-check kinds say what the final check actually did (2, 3)", () => {
  it("HARD_VIOLATIONS distinguishes the final check's new conflicts", () => {
    const sentence = describeReadinessSentence(eligible, failures.HARD_VIOLATIONS);
    expect(sentence).toContain(`${FINAL_CHECK} found hard violations`);
    expect(sentence).toContain(`${DISAGREEMENT} — see the refusal below`);
    expect(sentence).toContain(eligible.reason);
  });
  it("INCOMPLETE_VALIDATION distinguishes missing context, not new conflicts", () => {
    const sentence = describeReadinessSentence(eligible, failures.INCOMPLETE_VALIDATION);
    expect(sentence).toContain(`${FINAL_CHECK} could not finish`);
    expect(sentence).toContain("missing");
    expect(sentence).not.toContain(DISAGREEMENT); expect(sentence).not.toContain(`${FINAL_CHECK} found hard violations`);
  });
});

describe("STALE asks for reload and review without claiming new hard violations (4)", () => {
  it("holds for every stale reason", () => {
    for (const reason of ["VERSION_NOT_FOUND", "VERSION_NOT_DRAFT", "SNAPSHOT_CHANGED", "PUBLISHED_SET_CHANGED"] as const) {
      const sentence = describeReadinessSentence(eligible, { ok: false, kind: "STALE", reason });
      expect(sentence).toContain("changed while publication ran");
      expect(sentence).toContain("reload"); expect(sentence).toContain("review");
      expect(sentence).not.toContain(DISAGREEMENT); expect(sentence).not.toContain(`${FINAL_CHECK} found hard violations`);
    }
  });
});

describe("refusals that are not validation disagreements (5, 6, 7, 8, 9)", () => {
  it("FORBIDDEN and UNAUTHENTICATED never suggest a disagreement", () => {
    for (const failure of [failures.FORBIDDEN, failures.UNAUTHENTICATED]) {
      const sentence = describeReadinessSentence(eligible, failure);
      expect(sentence).toContain("access grounds");
      expect(sentence).not.toContain(DISAGREEMENT); expect(sentence).not.toContain(FINAL_CHECK);
    }
  });
  it("INTERNAL_ERROR, INVALID_INPUT, EMPTY_DRAFT and INVALID_VERSION_DATA invent no verdict", () => {
    for (const failure of [failures.INTERNAL_ERROR, failures.INVALID_INPUT, failures.EMPTY_DRAFT, failures.INVALID_VERSION_DATA]) {
      const sentence = describeReadinessSentence(eligible, failure);
      expect(sentence).toContain("without reporting a validation verdict");
      expect(sentence).not.toContain(DISAGREEMENT); expect(sentence).not.toContain(FINAL_CHECK);
    }
  });
  it("NOT_DRAFT and VERSION_NOT_FOUND say the version is unavailable, not conflicted", () => {
    for (const failure of [failures.NOT_DRAFT, failures.VERSION_NOT_FOUND]) {
      const sentence = describeReadinessSentence(eligible, failure);
      expect(sentence).toContain("no longer available for publication");
      expect(sentence).not.toContain(DISAGREEMENT); expect(sentence).not.toContain(FINAL_CHECK);
    }
  });
  it("across all eleven kinds only HARD_VIOLATIONS claims the checks disagreed", () => {
    for (const failure of allFailures) {
      const sentence = describeReadinessSentence(eligible, failure);
      expect(sentence.includes(DISAGREEMENT), failure.kind).toBe(failure.kind === "HARD_VIOLATIONS");
      expect(sentence).toContain(eligible.reason); expect(sentence).toContain(PUBLISH_ELIGIBILITY_NOTE);
    }
  });
});

describe("blocked drafts and the frozen legacy contract (10)", () => {
  it("a blocked draft stays blocked whatever result is presented", () => {
    const blocked = [decidePublishReadiness(clashCheck, 54), decidePublishReadiness(incompleteCheck, 54), decidePublishReadiness(cleanCheck, 0)];
    const results: (DraftPublishResult | boolean | null)[] = [null, false, true, success, ...allFailures];
    for (const readiness of blocked) for (const result of results) {
      expect(describeReadinessSentence(readiness, result)).toBe(`Publication is blocked: ${readiness.reason}`);
    }
  });
  it("the frozen kind-less boolean contract still holds, hedged rather than asserted", () => {
    expect(describeReadinessSentence(eligible, true)).toContain(`${DISAGREEMENT} — see the refusal below`);
    expect(describeReadinessSentence(eligible, true)).toContain("may or may not mean");
    expect(describeReadinessSentence(eligible, false)).toBe(eligibleSentence);
  });
});

describe("confirmation and request behaviour are unchanged (12)", () => {
  it("keeps the one-field request and both gates", () => {
    expect(buildPublishRequest("ver-x")).toEqual({ versionId: "ver-x" });
    expect(Object.keys(buildPublishRequest("ver-x"))).toEqual(["versionId"]);
    expect(canConfirmPublish({ readiness: eligible, confirming: true, pending: false })).toBe(true);
    expect(canConfirmPublish({ readiness: eligible, confirming: true, pending: true })).toBe(false);
    expect(canConfirmPublish({ readiness: decidePublishReadiness(clashCheck, 54), confirming: true, pending: false })).toBe(false);
    expect(canOpenConfirmation({ readiness: eligible, confirming: false, pending: false })).toBe(true);
    expect(canOpenConfirmation({ readiness: eligible, confirming: false, pending: true })).toBe(false);
  });
  it("keeps the request-state wording for pending, refused and committed", () => {
    expect(describeRequestState(false, null)).toBe("No request has been sent yet");
    expect(describeRequestState(true, failures.HARD_VIOLATIONS)).toBe("Publication request in progress");
    expect(describeRequestState(false, failures.FORBIDDEN)).toContain("was sent and refused — nothing was published");
    expect(describeRequestState(false, success)).toContain("committed this publication");
  });
  it("renders the normal eligibility sentence and no refusal wording on first paint", () => {
    const html = renderToStaticMarkup(createElement(DraftPublishForm, { versionId: "ver-x", semester: 1, entryCount: 54, validation: cleanCheck }));
    expect(html).toContain(eligible.reason);
    expect(html).toContain("No request has been sent yet");
    expect(html).not.toContain(DISAGREEMENT);
  });
});