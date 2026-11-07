"use client";

import Link from "next/link";
import type { TimetableVersionStatus } from "@/domain/types";
import type { DraftPublishResult, PublishStaleReason } from "@/server/draftPublishContract";

/**
 * What the officer is told about a publication request (M4-T3c2). Pure presentation of the typed
 * `DraftPublishResult` the accepted M4-T3a service produces: this module decides no permission, reads
 * no data, writes nothing and re-validates nothing — the server action and the service stay the boundary.
 *
 * Two honesty rules are structural rather than incidental: (1) `published` is true only for `ok: true`,
 * and every refusal heading says in plain words that nothing was published — a draft that was merely
 * checked is never presented as a new current timetable; (2) only fixed strings, the server's own
 * messages and ids the server returned are rendered, so an exception, SQL or a snapshot fingerprint
 * cannot reach the page.
 */

export type PublishDetailGroup = { heading: string; items: string[] };

export type PublishOutcomeView = {
  tone: "success" | "danger";
  /** Only `ok: true` ever sets this true. */
  published: boolean;
  heading: string;
  facts: string[];
  /** Validator messages the officer has to read: clashes and missing context. */
  groups: PublishDetailGroup[];
  nextStep: string;
};

const STATUS_WORDS: Record<TimetableVersionStatus, string> = { DRAFT: "a draft", PUBLISHED: "published", ARCHIVED: "archived" };

/**
 * The stored instant in UTC with fixed field order, so the same row reads the same in every browser
 * timezone and an officer can compare it with the audit log. Only used for a date the server returned.
 */
export function formatPublishedAt(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())} UTC`;
}

// So a draft with one row is not described with a plural noun or plural verbs.
function pluralEntries(count: number): string { return `${count} ${count === 1 ? "entry" : "entries"}`; }
function isAre(count: number): string { return count === 1 ? "is" : "are"; }
function itOrThem(count: number): string { return count === 1 ? "it" : "them"; }

type PublishFailure = Exclude<DraftPublishResult, { ok: true }>;

/** One line per typed refusal kind, so a missing kind fails the type check. */
const FAILURE_COPY: Record<PublishFailure["kind"], { heading: string; nextStep: string }> = {
  UNAUTHENTICATED: { heading: "Your session has expired — nothing was published.", nextStep: "Sign in again as the timetabling officer, then publish the draft." },
  FORBIDDEN: { heading: "You are not allowed to publish timetables — nothing was published.", nextStep: "Use an officer account, or ask the demo operator which account publishes." },
  INVALID_INPUT: { heading: "The publication request was refused — nothing was published.", nextStep: "Reload the draft editor, pick the draft again and confirm once." },
  VERSION_NOT_FOUND: { heading: "That version no longer exists — nothing was published.", nextStep: "Reload the draft editor and pick a draft from the list." },
  NOT_DRAFT: { heading: "That version is no longer an editable draft — nothing was published.", nextStep: "Another operation may already have published or archived it. Reload, review the current draft and publish that one." },
  EMPTY_DRAFT: { heading: "A draft with no entries cannot be published — nothing was published.", nextStep: "Generate or add the sessions first; publishing an empty board would replace the semester's timetable with nothing." },
  HARD_VIOLATIONS: { heading: "Hard violations block publication — nothing was published.", nextStep: "Fix every clash below in the draft editor, then publish again." },
  INCOMPLETE_VALIDATION: { heading: "Publication is blocked because the checks could not finish — nothing was published.", nextStep: "Repair the missing teaching or venue data below, then publish again." },
  INVALID_VERSION_DATA: { heading: "That version's stored data is inconsistent — nothing was published.", nextStep: "Ask the demo operator to check the version row before publishing again." },
  STALE: { heading: "The draft or the data behind it changed while publication ran — nothing was published.", nextStep: "The draft state below has been reloaded — review it and publish again." },
  INTERNAL_ERROR: { heading: "The publication failed — nothing was published.", nextStep: "Try again. If it keeps failing, tell the demo operator — no version was changed." },
};

/** What the accepted adapter actually re-checked inside its transaction. */
const STALE_REASON_COPY: Record<PublishStaleReason, string> = {
  VERSION_NOT_FOUND: "The version disappeared before the write committed.",
  VERSION_NOT_DRAFT: "It was no longer stored as a DRAFT when the transaction ran — another operation may have published or archived it first.",
  SNAPSHOT_CHANGED: "The draft rows, or the teaching, venue, availability or policy data the checks use, changed after the draft was validated.",
  PUBLISHED_SET_CHANGED: "A different publication changed which versions are current for this semester.",
};

function failureFacts(result: PublishFailure): string[] {
  switch (result.kind) {
    case "INVALID_INPUT": return [result.message];
    case "VERSION_NOT_FOUND": return [`Version ${result.versionId} was not found.`];
    case "NOT_DRAFT": return [`Version ${result.versionId} is stored as ${STATUS_WORDS[result.storedStatus]}, so it cannot be published as a draft.`];
    case "EMPTY_DRAFT": return [`Draft ${result.versionId} contains no timetable entries at all.`];
    case "HARD_VIOLATIONS": return [
      `The final check of version ${result.versionId} found ${result.violations.length === 1 ? "1 hard violation" : `${result.violations.length} hard violations`}.`,
      "Publication is refused while any hard rule is broken.",
    ];
    case "INCOMPLETE_VALIDATION": return [
      `The checks of version ${result.versionId} could not finish — ${pluralEntries(result.missingContext.length)} ${isAre(result.missingContext.length)} missing the data needed to check ${itOrThem(result.missingContext.length)}.`,
      "An unfinished check is not a clean draft, so publication is refused.",
    ];
    case "INVALID_VERSION_DATA": return [result.message];
    case "STALE": return [STALE_REASON_COPY[result.reason]];
    case "UNAUTHENTICATED": case "FORBIDDEN": case "INTERNAL_ERROR": return [];
  }
}

/** Every validator message the result carries, grouped so nothing is summarised away. */
function detailGroupsOf(result: PublishFailure): PublishDetailGroup[] {
  if (result.kind === "HARD_VIOLATIONS") return [{ heading: "Hard violations that block publication", items: result.violations.map((v) => v.message) }];
  if (result.kind !== "INCOMPLETE_VALIDATION") return [];
  const groups: PublishDetailGroup[] = [];
  if (result.violations.length > 0) groups.push({ heading: "Conflicts found before the checks stopped", items: result.violations.map((v) => v.message) });
  groups.push({ heading: "What the checks could not finish", items: result.missingContext.map((m) => m.message) });
  return groups;
}

/** The officer-facing view of one typed publication result. */
export function describePublishResult(result: DraftPublishResult): PublishOutcomeView {
  if (result.ok) {
    return {
      tone: "success", published: true,
      heading: `Version ${result.versionId} is now the published timetable for semester ${result.semester}.`,
      facts: [
        `Published at ${formatPublishedAt(result.publishedAt)} — the server's clock, never a browser value.`,
        result.archivedVersionIds.length === 0
          ? `Semester ${result.semester} had no earlier published version, so nothing was archived.`
          : `Previously published and now archived: ${result.archivedVersionIds.join(", ")}.`,
        "Archived versions keep their entries; nothing was deleted.",
        `Version ${result.versionId} is stored as ${STATUS_WORDS.PUBLISHED}, so it is no longer an editable DRAFT and leaves the draft picker.`,
      ],
      groups: [],
      nextStep: "This page has reloaded to the server-verified published state. Open the published timetable to review the current version for this semester.",
    };
  }
  return {
    tone: "danger", published: false,
    heading: FAILURE_COPY[result.kind].heading,
    facts: failureFacts(result),
    groups: detailGroupsOf(result),
    nextStep: FAILURE_COPY[result.kind].nextStep,
  };
}

const PANEL_CLASSES = {
  success: "border-green-200 bg-green-50 text-green-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  neutral: "border-slate-200 bg-white text-slate-700",
} as const;

function DetailGroups({ groups }: { groups: PublishDetailGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide">Reasons</p>
      <ul className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-md border border-red-200 bg-white p-3">
        {groups.map((group) => (
          <li key={group.heading} className="text-xs">
            <p className="font-semibold text-slate-800">{group.heading}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
              {group.items.map((item, index) => (<li key={`${group.heading}-${index}`} className="break-words">{item}</li>))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Result panel, separate from the controls so each typed outcome is testable. */
export function PublishResultPanel({ result }: { result: DraftPublishResult | null }) {
  if (result === null) return null;
  const view = describePublishResult(result);
  const danger = view.tone === "danger";
  return (
    <section
      aria-labelledby="publish-outcome-heading"
      role={danger ? "alert" : "status"}
      aria-live={danger ? "assertive" : "polite"}
      className={`mt-4 rounded-md border p-4 text-sm ${PANEL_CLASSES[view.tone]}`}
    >
      <h3 id="publish-outcome-heading" className="text-sm font-semibold">{view.heading}</h3>
      {view.facts.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">{view.facts.map((fact) => (<li key={fact}>{fact}</li>))}</ul>
      )}
      <DetailGroups groups={view.groups} />
      <p className="mt-2 text-xs font-medium">{view.nextStep}</p>
      {result.ok && <Link href={`/timetable?semester=${result.semester}`} className="mt-3 inline-block font-semibold underline focus:outline-none focus:ring-2 focus:ring-indigo-500">View current published timetable</Link>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The server-verified post-publication page state (?published=<id>)
// ---------------------------------------------------------------------------

/**
 * What the page's own read of the stored version says about the id in the address bar. The id is
 * untrusted: `verified` is only ever built from a row the server read and found stored PUBLISHED with a
 * publication time, so a forged, stale or contradictory address can never produce a success confirmation,
 * and the archived ids the action returned are never rebuilt from a query parameter.
 */
export type PublishedPanelState =
  | { kind: "verified"; versionId: string; semester: number; publishedAt: Date; entryCount: number }
  | { kind: "other-status"; versionId: string; storedStatus: TimetableVersionStatus }
  | { kind: "inconsistent"; versionId: string; reason: "UNREADABLE_STATUS" | "NO_PUBLISHED_AT" }
  | { kind: "absent"; versionId: string };

export type PublishedPanelView = { tone: "success" | "neutral"; heading: string; facts: string[]; nextStep: string };

const INCONSISTENT_COPY: Record<"UNREADABLE_STATUS" | "NO_PUBLISHED_AT", string> = {
  UNREADABLE_STATUS: "Its stored status is not one this prototype can read, so its publication state is unknown.",
  NO_PUBLISHED_AT: "It is marked published but carries no publication time, so its record is incomplete.",
};

export function describePublishedPanel(state: PublishedPanelState): PublishedPanelView {
  if (state.kind === "verified") {
    return {
      tone: "success",
      heading: `Version ${state.versionId} is the published timetable for semester ${state.semester}.`,
      facts: [
        "The server read this version and its stored status is PUBLISHED — the address in your browser is not what makes it so.",
        `Published at ${formatPublishedAt(state.publishedAt)}.`,
        `${pluralEntries(state.entryCount)} ${isAre(state.entryCount)} stored under this version and ${state.entryCount === 1 ? "was" : "were"} left unchanged.`,
        "It is no longer a DRAFT, so it does not appear in the draft editor's version picker.",
      ],
      nextStep: "Open the published timetable to review the current version for this semester, or return to the draft editor to work on another draft.",
    };
  }
  if (state.kind === "absent") {
    return {
      tone: "neutral",
      heading: `Version ${state.versionId} was not found.`,
      facts: ["No publication was confirmed for it."],
      nextStep: "Return to the draft editor and pick a draft from the list.",
    };
  }
  // None of these can claim anything: the row is not published, or its stored
  // state contradicts itself, so nothing here is guessed.
  const reason = state.kind === "inconsistent" ? INCONSISTENT_COPY[state.reason] : `The server found it stored as ${STATUS_WORDS[state.storedStatus]}, not published.`;
  return {
    tone: "neutral",
    heading: `Nothing can be confirmed for version ${state.versionId}.`,
    facts: [reason],
    nextStep: "Return to the draft editor and check the current draft and its status before publishing.",
  };
}

export function PublishedVersionPanel({ state }: { state: PublishedPanelState }) {
  const view = describePublishedPanel(state);
  const success = view.tone === "success";
  return (
    <section
      aria-labelledby="published-state-heading"
      role={success ? "status" : "alert"}
      aria-live={success ? "polite" : "assertive"}
      className={`mt-4 rounded-md border p-4 text-sm ${PANEL_CLASSES[view.tone]}`}
    >
      <h2 id="published-state-heading" className="text-sm font-semibold">{view.heading}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">{view.facts.map((fact) => (<li key={fact}>{fact}</li>))}</ul>
      <p className="mt-2 text-xs font-medium">{view.nextStep}</p>
      {state.kind === "verified" && <Link href={`/timetable?semester=${state.semester}`} className="mt-3 inline-block font-semibold underline focus:outline-none focus:ring-2 focus:ring-indigo-500">View current published timetable</Link>}
      <p className="mt-3 text-xs">
        <a href="/officer/draft" className="text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">Back to the draft editor</a>
      </p>
    </section>
  );
}
