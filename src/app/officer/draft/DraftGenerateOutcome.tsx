"use client";

import type { UnplacedActivity, UnplacedFixed } from "@/domain/generator";
import type { TimetableVersionStatus } from "@/domain/types";
import type { DraftGenerateResult } from "@/server/draftGenerateContract";

/**
 * What the officer is told after a generate request (M4-T2c2). Pure
 * presentation of the typed `DraftGenerateResult` the accepted service
 * produces: this module decides no permission, reads no data and writes
 * nothing — the action and the service stay the security boundary.
 *
 * Two honesty rules are structural here rather than incidental:
 * 1. `saved` is true only for `ok: true`, and every failure heading says in
 *    plain words that nothing was saved — a placement count is never presented
 *    as a draft;
 * 2. only fixed strings and the messages the server itself phrased are
 *    rendered, so an exception, a query or an internal database detail cannot
 *    reach the page.
 */

/** A locked-row problem is never presented as an ordinary unscheduled class. */
export type UnplacedRowView = {
  key: string;
  subject: string;
  /** The generator's reason code, kept so the wording can be asserted. */
  reason: string;
  text: string;
  fixed: boolean;
};

export type GenerateOutcomeView = {
  tone: "success" | "danger";
  heading: string;
  /** Only `ok: true` ever sets this true. */
  saved: boolean;
  facts: string[];
  unplaced: UnplacedRowView[];
  /** Present when a search-budget cut explains part of the result. */
  budgetNote: string | null;
  nextStep: string;
};

const ACTIVITY_REASON_WORDS: Record<string, string> = {
  NO_COMPATIBLE_VENUE: "no venue fits it",
  NO_FREE_SLOT: "no free slot in the week",
  STEP_LIMIT: "search budget reached",
};

const FIXED_REASON_WORDS: Record<UnplacedFixed["reason"], string> = {
  FIXED_UNRESOLVED: "locked entry that could not be kept",
  FIXED_CONFLICT: "locked entry that conflicts with the new board",
};

const STATUS_WORDS: Record<TimetableVersionStatus, string> = {
  DRAFT: "marked as a draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
};

/** Search bound reached — a rough board, not proof that no timetable exists. */
export const STEP_LIMIT_NOTE =
  "Sessions marked “search budget reached” stopped the generator's own search, not the timetable: " +
  "the prototype allows a fixed number of candidate checks, so these sessions are not proven impossible.";

const MISSING_CONTEXT_NEXT_STEP =
  "The validator could not finish because teaching or venue data is missing — repair that data first, then generate again.";

const PARTIAL_NEXT_STEP =
  "Correct the venue, capacity or availability data behind these reasons, or unlock the entry, then generate again. No partial draft was written.";

type GenerateFailure = Exclude<DraftGenerateResult, { ok: true }>;

/** One line per typed refusal kind, so a missing kind fails the type check. */
const FAILURE_COPY: Record<GenerateFailure["kind"], { heading: string; nextStep: string }> = {
  UNAUTHENTICATED: { heading: "Your session has expired — nothing was saved.", nextStep: "Sign in again as the timetabling officer, then generate the draft." },
  FORBIDDEN: { heading: "You are not allowed to generate draft timetables — nothing was saved.", nextStep: "Use an officer account, or ask the demo operator which account generates drafts." },
  INVALID_INPUT: { heading: "The generation request was refused — nothing was saved.", nextStep: "Check the semester and the source choice, then submit again." },
  SOURCE_NOT_FOUND: { heading: "That source draft no longer exists — nothing was saved.", nextStep: "Reload the page, then pick another source draft or generate a fresh draft." },
  SOURCE_NOT_DRAFT: { heading: "That version is not an editable draft — nothing was saved.", nextStep: "Pick a draft version as the source, or generate a fresh draft." },
  INCOMPLETE_INPUT: { heading: "The generator's input is incomplete — nothing was saved.", nextStep: "Fix the data problems listed above, then generate again." },
  PARTIAL_GENERATION: { heading: "No draft was saved — the timetable is incomplete.", nextStep: PARTIAL_NEXT_STEP },
  INVALID_GENERATION: { heading: "The generated timetable breaks a hard rule — nothing was saved.", nextStep: "Free the venues, times or availability behind these clashes, then generate again." },
  STALE: { heading: "The source draft changed while the timetable was being generated — nothing was saved.", nextStep: "The draft options have been reloaded — pick the source again and generate once more." },
  INTERNAL_ERROR: { heading: "The draft could not be generated — nothing was saved.", nextStep: "Try again. If it keeps failing, tell the demo operator — nothing was written." },
};

export function describeUnplaced(row: UnplacedActivity | UnplacedFixed): UnplacedRowView {
  return row.kind === "FIXED"
    ? {
        key: `fixed-${row.entryId}-${row.reason}`,
        subject: `Locked entry ${row.entryId} — ${FIXED_REASON_WORDS[row.reason]}`,
        reason: row.reason,
        text: row.message,
        fixed: true,
      }
    : {
        key: `activity-${row.activityId}-${row.reason}`,
        subject: `Session for ${row.unitCode} — ${ACTIVITY_REASON_WORDS[row.reason] ?? row.reason}`,
        reason: row.reason,
        text: row.message,
        fixed: false,
      };
}

function failureFacts(result: GenerateFailure): string[] {
  switch (result.kind) {
    case "INVALID_INPUT":
      return [result.message];
    case "SOURCE_NOT_FOUND":
      return [`Source version ${result.sourceVersionId} was not found.`];
    case "SOURCE_NOT_DRAFT":
      return [
        `Version ${result.sourceVersionId} is ${STATUS_WORDS[result.storedStatus]}, so its locked rows cannot be carried over.`,
      ];
    case "INCOMPLETE_INPUT":
      return result.problems.map((problem) => problem.message);
    case "PARTIAL_GENERATION": {
      const activities = result.unplaced.filter((row) => row.kind === "ACTIVITY").length;
      const fixed = result.unplaced.length - activities;
      return [
        `${result.placedCount} sessions could be placed, but this prototype saves nothing until every required session and every locked row is settled.`,
        activities > 0
          ? `${activities} required ${activities === 1 ? "session" : "sessions"} could not be scheduled.`
          : "No required session was left unplaced.",
        fixed > 0
          ? `${fixed} locked ${fixed === 1 ? "entry needs" : "entries need"} attention before a draft can be kept.`
          : "No locked entry was refused.",
      ];
    }
    case "INVALID_GENERATION":
      return [
        ...result.violations.map((violation) => violation.message),
        ...result.missingContext.map((missing) => missing.message),
      ];
    case "STALE":
      return [
        result.sourceVersionId === null
          ? "The draft was generated without a source, so no locked rows were kept."
          : `Locked rows of source draft ${result.sourceVersionId} changed before the write.`,
      ];
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
    case "INTERNAL_ERROR":
      return [];
  }
}

/** The officer-facing view of one typed result. */
export function describeGenerateResult(result: DraftGenerateResult): GenerateOutcomeView {
  if (result.ok) {
    return {
      tone: "success",
      heading: `Draft version ${result.versionId} was created.`,
      saved: true,
      facts: [
        `${result.entryCount} ${result.entryCount === 1 ? "entry is" : "entries are"} saved as a DRAFT.`,
        `Soft score ${result.softScore} — 0 is ideal, higher means a rougher week.`,
        "This is a draft: it is not published and not an official university record.",
      ],
      unplaced: [],
      budgetNote: null,
      nextStep: "The draft editor has reloaded this version and checked every hard rule against it.",
    };
  }
  const unplaced =
    result.kind === "PARTIAL_GENERATION" ? result.unplaced.map(describeUnplaced) : [];
  const copy = FAILURE_COPY[result.kind];
  return {
    tone: "danger",
    heading:
      result.kind === "PARTIAL_GENERATION"
        ? `${copy.heading} ${result.unplaced.length} ${result.unplaced.length === 1 ? "item is" : "items are"} unresolved.`
        : copy.heading,
    saved: false,
    facts: failureFacts(result),
    unplaced,
    budgetNote: unplaced.some((row) => row.reason === "STEP_LIMIT") ? STEP_LIMIT_NOTE : null,
    nextStep:
      result.kind === "INVALID_GENERATION" && result.missingContext.length > 0
        ? MISSING_CONTEXT_NEXT_STEP
        : copy.nextStep,
  };
}

const PANEL_CLASSES = {
  success: "border-green-200 bg-green-50 text-green-800",
  danger: "border-red-200 bg-red-50 text-red-800",
} as const;

/**
 * Result panel, separate from the form so a test can render every typed
 * outcome. A saved draft reads as a status; anything else reads as an alert,
 * and the unplaced list scrolls so a long reason list stays usable on a phone.
 */
export function GenerateResultPanel({ result }: { result: DraftGenerateResult | null }) {
  if (result === null) return null;
  const view = describeGenerateResult(result);
  const danger = view.tone === "danger";
  return (
    <section
      aria-labelledby="generate-outcome-heading"
      role={danger ? "alert" : "status"}
      aria-live={danger ? "assertive" : "polite"}
      className={`mt-4 rounded-md border p-4 text-sm ${PANEL_CLASSES[view.tone]}`}
    >
      <h3 id="generate-outcome-heading" className="text-sm font-semibold">
        {view.heading}
      </h3>
      {view.facts.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {view.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {view.unplaced.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide">Why each item is unresolved</p>
          <ul className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-md border border-red-200 bg-white p-3">
            {view.unplaced.map((row) => (
              <li key={row.key} className="text-xs">
                <span className="font-semibold text-slate-800">{row.subject}</span>
                <p className="mt-0.5 break-words text-slate-700">{row.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.budgetNote !== null && <p className="mt-2 text-xs">{view.budgetNote}</p>}
      <p className="mt-2 text-xs font-medium">{view.nextStep}</p>
    </section>
  );
}
