/** Authenticated published timetable page. Page entry grants no record access;
 * the service authorizes every selection and returned session. Selector options
 * use the same trusted relationship policy and never include unrelated records. */
import { requireAnyAction } from "@/server/guards";
import { createPublishedTimetableStore } from "@/server/publishedTimetableStorePrisma";
import { loadTimetableOptions, type TimetableOptions } from "@/server/publishedTimetableOptions";
import type { Actor } from "@/domain/permissions";
import { readPublishedTimetable } from "@/server/publishedTimetable";
import { buildPublishedWeekGrid, type PublishedWeekGridResult } from "@/domain/publishedWeekGrid";
import { DEFAULT_POLICY } from "@/domain/policy";
import {
  DEFAULT_SEMESTER,
  type PublishedTimetableRequest,
  type PublishedTimetableResult,
  type PublishedTimetableStore,
  type ViewingPerspective,
} from "@/server/publishedTimetableContract";
import { PublishedWeekTable } from "./PublishedWeekTable";
import { PublishedTimetableControls } from "./PublishedTimetableControls";

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

type Failure = Exclude<PublishedTimetableResult, { ok: true }>;
type AlertTone = "error" | "warning" | "info";
type SelectorData = TimetableOptions;

const PERSPECTIVE_LABELS: Record<ViewingPerspective, string> = {
  group: "Student group",
  lecturer: "Lecturer",
  venue: "Venue",
};

/** Fixed heading, next step and tone per typed failure — never rendered from stored text. */
const FAILURE_COPY: Record<Failure["kind"], { heading: string; next: string; tone: AlertTone }> = {
  UNAUTHENTICATED: {
    heading: "Sign-in required",
    next: "Sign in again to view the published timetable.",
    tone: "warning",
  },
  FORBIDDEN: {
    heading: "Not permitted",
    next: "This timetable is outside your permitted scope. Return to your default view or contact the timetabling department.",
    tone: "error",
  },
  INVALID_INPUT: {
    heading: "Invalid timetable request",
    next: "Choose semester 1 or 2 and a group, lecturer or venue view, then try again.",
    tone: "warning",
  },
  NO_PUBLISHED_VERSION: {
    heading: "No published timetable",
    next: "Ask the timetabling department to publish a version for this semester. No published timetable does not mean there are no classes.",
    tone: "warning",
  },
  AMBIGUOUS_PUBLISHED_VERSION: {
    heading: "More than one published version",
    next: "The department must resolve which version is current. This page will not choose one for you.",
    tone: "error",
  },
  SELECTION_REQUIRED: {
    heading: "Choose a timetable",
    next: "Pick a specific group, lecturer or venue above, then try again.",
    tone: "warning",
  },
  SELECTION_NOT_FOUND: {
    heading: "Selection not found",
    next: "That item is no longer available. Choose another group, lecturer or venue above.",
    tone: "warning",
  },
  IDENTITY_UNRESOLVED: {
    heading: "Your timetable identity is not set up",
    next: "Ask the timetabling department to check your student group, lecturer profile or department link. Choosing another identity cannot grant access.",
    tone: "warning",
  },
  INVALID_PUBLISHED_DATA: {
    heading: "Published data is incomplete",
    next: "The stored publication is missing required details. Tell the demo operator; no timetable is shown until it is corrected.",
    tone: "error",
  },
  STALE: {
    heading: "The published timetable changed",
    next: "A newer publication replaced this version while it was loading. Reload the page to see the current timetable.",
    tone: "warning",
  },
  INTERNAL_ERROR: {
    heading: "The timetable could not be loaded",
    next: "Please try again. If it keeps failing, tell the demo operator.",
    tone: "error",
  },
};

/** The specific "what happened" sentence; message-carrying kinds use the service's own plain language. */
function failureBody(result: Failure): string {
  switch (result.kind) {
    case "INVALID_INPUT":
    case "SELECTION_REQUIRED":
    case "IDENTITY_UNRESOLVED":
    case "INVALID_PUBLISHED_DATA":
      return result.message;
    case "NO_PUBLISHED_VERSION":
      return `No version is published for semester ${result.semester}.`;
    case "AMBIGUOUS_PUBLISHED_VERSION":
      return `Semester ${result.semester} has more than one published version, so none can be identified as current.`;
    case "STALE":
      return `The version selected for semester ${result.semester} was replaced before its entries could be read. No outdated entries are shown.`;
    case "SELECTION_NOT_FOUND":
      return `The selected ${PERSPECTIVE_LABELS[result.view].toLowerCase()} (id ${result.selectionId}) was not found.`;
    case "UNAUTHENTICATED":
      return "Your session is not active.";
    case "FORBIDDEN":
      return "Your account is not allowed to view the published timetable.";
    case "INTERNAL_ERROR":
      return "An unexpected problem occurred while reading the timetable.";
  }
}

/** A grid refusal is a data-quality failure: no partial timetable, no discarded entry. */
function gridFailureCopy(result: Extract<PublishedWeekGridResult, { ok: false }>): {
  heading: string;
  body: string;
  next: string;
} {
  if (result.kind === "INVALID_ENTRY") {
    return {
      heading: "Published timetable has an invalid session",
      body: `Entry ${result.entryId} could not be placed on the weekly grid: ${result.message}`,
      next: "No partial timetable is shown and no entry is discarded. Tell the demo operator so the stored entry can be corrected.",
    };
  }
  return {
    heading: "Timetable display policy is invalid",
    body: `The weekly grid could not be built (${result.property}): ${result.message}`,
    next: "No partial timetable is shown. Tell the demo operator so the display policy can be corrected.",
  };
}

const ALLOWED_KEYS: readonly string[] = ["semester", "view", "id"];

type ParsedSelection =
  | { ok: true; request: PublishedTimetableRequest }
  | { ok: false; message: string };

/**
 * Validate untrusted URL input before the service sees it. Only the exact strings
 * "1"/"2" become a semester (semester=3 is rejected, never coerced to 1); arrays
 * are duplicate values and rejected; unknown keys, blank ids and an id without a
 * view are rejected. A view without an id passes through so the service can ask
 * for a selection (SELECTION_REQUIRED) rather than the page guessing one.
 */
function parseSelection(params: { [key: string]: string | string[] | undefined }): ParsedSelection {
  for (const key of Object.keys(params)) {
    if (!ALLOWED_KEYS.includes(key)) {
      return { ok: false, message: `Unknown timetable parameter "${key}". Only semester, view and id are supported.` };
    }
  }
  const request: PublishedTimetableRequest = {};
  const rawSemester = params.semester;
  if (rawSemester !== undefined) {
    if (typeof rawSemester !== "string") {
      return { ok: false, message: "Semester was supplied more than once. Choose a single semester." };
    }
    if (rawSemester === "1") request.semester = 1;
    else if (rawSemester === "2") request.semester = 2;
    else return { ok: false, message: `Invalid semester "${rawSemester}". Choose semester 1 or 2.` };
  }
  const rawView = params.view;
  if (rawView !== undefined) {
    if (typeof rawView !== "string") {
      return { ok: false, message: "View was supplied more than once. Choose a single perspective." };
    }
    if (rawView === "group" || rawView === "lecturer" || rawView === "venue") request.view = rawView;
    else return { ok: false, message: `Invalid perspective "${rawView}". Choose group, lecturer or venue.` };
  }
  const rawId = params.id;
  if (rawId !== undefined) {
    if (typeof rawId !== "string") {
      return { ok: false, message: "Id was supplied more than once. Choose a single item." };
    }
    const id = rawId.trim();
    if (id === "") {
      return { ok: false, message: "The selected item id is empty. Choose a specific group, lecturer or venue." };
    }
    if (request.view === undefined) {
      return { ok: false, message: "An id was supplied without a view. Choose a perspective (group, lecturer or venue) first." };
    }
    request.id = id;
  }
  return { ok: true, request };
}

/** Selector options come only from the read-only store; a failure is never an empty list. */
async function loadSelectors(
  store: PublishedTimetableStore,
  actor: Actor,
  semester: number,
): Promise<{ ok: true; data: SelectorData } | { ok: false }> {
  try {
    return { ok: true, data: await loadTimetableOptions(store, actor, semester) };
  } catch {
    // One fixed, non-sensitive line: the cause stays on the server, never the client.
    console.error("[timetable] selector options unavailable; rendering operational error");
    return { ok: false };
  }
}

/** Deterministic server-derived UTC label; the Date is the stored publishedAt, never a client value. */
function formatUtc(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())} UTC`;
}

function selectedLabel(data: SelectorData, view: ViewingPerspective, id: string): string {
  if (view === "group") return data.groups.find((row) => row.id === id)?.name ?? "Selected item unavailable";
  if (view === "lecturer") return data.lecturers.find((row) => row.id === id)?.displayName ?? "Selected item unavailable";
  return data.venues.find((row) => row.id === id)?.code ?? "Selected item unavailable";
}

const TONE_CLASSES: Record<AlertTone, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-cyan-200 bg-cyan-50 text-cyan-900",
};

function AlertPanel({
  heading,
  body,
  next,
  tone = "error",
}: {
  heading: string;
  body: string;
  next: string;
  tone?: AlertTone;
}) {
  return (
    <section role="alert" aria-live="assertive" className={`rounded-xl border p-4 shadow-sm ${TONE_CLASSES[tone]}`}>
      <h2 className="text-base font-bold">{heading}</h2>
      <p className="mt-1 text-sm">{body}</p>
      <p className="mt-2 text-sm font-semibold">{next}</p>
    </section>
  );
}

function MetadataPanel({
  result,
  label,
}: {
  result: Extract<PublishedTimetableResult, { ok: true }>;
  label: string;
}) {
  const count = result.entries.length;
  return (
    <section aria-label="Publication details" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-slate-800">Publication details</h2>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Semester</dt>
          <dd className="font-semibold text-slate-900">Semester {result.semester}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Perspective</dt>
          <dd className="font-semibold text-slate-900">{PERSPECTIVE_LABELS[result.view]}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected</dt>
          <dd className="font-semibold text-slate-900">{label}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Version ID</dt>
          <dd className="break-all font-mono text-xs text-slate-900">{result.version.id}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Published (server time, UTC)</dt>
          <dd className="font-semibold text-slate-900">{formatUtc(result.version.publishedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</dt>
          <dd className="font-semibold text-slate-900">{count} {count === 1 ? "session" : "sessions"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-600">
        This is the stored published timetable. Rendering it does not certify that it is conflict-free.
      </p>
    </section>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-bold text-slate-800">Published timetable</h1><p><a className="underline" href="/timetable/date">Schedule for a date (effective occurrences)</a> · Recurring weekly template shown below.</p>
        <p className="mt-1 text-sm text-slate-600">
          View the current published weekly timetable within your permitted group, teaching or department scope.
          This page is read-only: it never edits, generates or publishes a timetable.
        </p>
        {children}
      </div>
    </main>
  );
}

export default async function TimetablePage({ searchParams }: PageProps) {
  // FIRST action: page-entry authorization. redirect() throws and must stay
  // outside any try/catch, so a denied or signed-out caller never reaches a read.
  const user = await requireAnyAction("VIEW_TIMETABLE");
  const params = await searchParams;
  const parsed = parseSelection(params);

  const store = createPublishedTimetableStore();
  const semester = parsed.ok ? (parsed.request.semester ?? DEFAULT_SEMESTER) : DEFAULT_SEMESTER;
  const selectors = await loadSelectors(store, user, semester);
  if (!selectors.ok) {
    return (
      <PageShell>
        <div className="mt-6">
          <AlertPanel
            heading="Timetable options are unavailable"
            body="The list of groups, lecturers and venues could not be loaded."
            next="Please try again. If it keeps failing, tell the demo operator."
          />
        </div>
      </PageShell>
    );
  }

  let activeView: ViewingPerspective | null = null;
  let activeId: string | null = null;
  let body: React.ReactNode;

  if (!parsed.ok) {
    body = (
      <AlertPanel
        tone="warning"
        heading="Invalid timetable request"
        body={parsed.message}
        next="Use the selectors above to choose a semester and a group, lecturer or venue."
      />
    );
  } else {
    const result = await readPublishedTimetable(store, user, parsed.request);
    if (!result.ok) {
      const copy = FAILURE_COPY[result.kind];
      body = <AlertPanel tone={copy.tone} heading={copy.heading} body={failureBody(result)} next={copy.next} />;
    } else {
      activeView = result.view;
      activeId = result.selectionId;
      const gridResult = buildPublishedWeekGrid(result.entries, DEFAULT_POLICY);
      if (!gridResult.ok) {
        const copy = gridFailureCopy(gridResult);
        body = <AlertPanel heading={copy.heading} body={copy.body} next={copy.next} />;
      } else {
        body = (
          <>
            <MetadataPanel result={result} label={selectedLabel(selectors.data, result.view, result.selectionId)} />
            <div className="mt-4">
              <PublishedWeekTable grid={gridResult.grid} view={result.view} />
            </div>
          </>
        );
      }
    }
  }

  return (
    <PageShell>
      <PublishedTimetableControls
        semester={semester}
        activeView={activeView}
        activeId={activeId}
        groups={selectors.data.groups}
        lecturers={selectors.data.lecturers}
        venues={selectors.data.venues}
        perspectives={user.role === "STUDENT" ? [] : selectors.data.access.perspectives}
      />
      <div className="mt-6">{body}</div>
    </PageShell>
  );
}