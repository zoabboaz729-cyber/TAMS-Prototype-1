/**
 * /officer/draft — officer draft editor (M3-T2b2; behaviour corrected in
 * M3-T2b2a; add-entry form integrated in M3-T2b3c; generate-draft controls and
 * the no-drafts state added in M4-T2c2).
 *
 * Server-rendered view of one DRAFT timetable version: every entry, its
 * resolved unit/venue codes, and the M3 validator's violations shown inline
 * with plain-language messages. Each unlocked row gets a move form whose
 * expected previous schedule comes from this server render, so a stale move
 * is refused by the accepted two-layer compare-and-set (M3-T2b1a). The add
 * form below creates a new session through the accepted `addDraftEntryAction`
 * (M3-T2b3a/b); the version id it submits is this page's server-side choice,
 * never a browser-supplied field.
 *
 * Authorization: requireAction("EDIT_DRAFT") at page entry (ALL-scope for
 * the officer, NONE for every other role) and the loader re-decides EDIT_DRAFT
 * before any read — the layout is not a security boundary. The generate form
 * is shown only when `GENERATE_TIMETABLE` allows the session user, which
 * narrows this page's content, not the action: `generateDraftAction` decides
 * the permission again before it creates a store.
 *
 * With no DRAFT version at all the page still renders the generation controls
 * and an explanation, because generating is the only way to create the first
 * draft; the entry editor appears once one exists.
 *
 * The conflict-free statement is only ever made from a fresh server render:
 * after a successful move or add the client calls router.refresh(), this page
 * re-runs loadDraftForValidation(), and the outcome below decides what is
 * shown. A move, add or generate result alone never says the draft is clean
 * (requirement #9).
 */
import { requireAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { createDraftValidationStore } from "@/server/draftStorePrisma";
import { loadDraftForValidation } from "@/server/draftValidation";
import { loadVenueRecords } from "@/server/venueData";
import { DraftTable } from "./DraftTable";
import { DraftAddForm, type DraftTeachingOption } from "./DraftAddForm";
import { decideAccess } from "@/domain/access";
import { DraftGenerateForm } from "./DraftGenerateForm";
import { mapViolationsToRows, validationSummary } from "@/domain/draftViolations";
import type { DraftSummaryTone } from "@/domain/draftViolations";

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Fixed copy per loader refusal kind — never rendered from stored text. */
const LOADER_REFUSAL_MESSAGES: Record<
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "NOT_DRAFT" | "INTERNAL_ERROR",
  string
> = {
  UNAUTHENTICATED: "Your session has expired. Sign in again to open the draft editor.",
  FORBIDDEN: "You are not allowed to edit draft timetables.",
  NOT_FOUND:
    "That draft version was not found. It may have been deleted — pick a version above.",
  NOT_DRAFT:
    "That version is not an editable draft (it may be published or archived). Pick a draft above.",
  INTERNAL_ERROR:
    "The draft could not be loaded. Please try again — if it keeps failing, tell the demo operator.",
};

/** Summary banner classes per tone — the text comes from the pure domain rule. */
const SUMMARY_CLASSES: Record<DraftSummaryTone, string> = {
  success: "border-green-200 bg-green-50 text-green-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
};

/**
 * Scheduled teaching assignments the officer can add a session for, in the
 * semester of the selected draft (M3-T2b3c). A thin guarded read — the page
 * has already passed requireAction("EDIT_DRAFT"), whose scope is ALL, so the
 * officer sees every department's teachings. One unit can have several
 * teachings (DEMO-MAT101 is taught to both CS-Y2 and SE-Y1), so the option
 * value is the real Teaching.id and the label names the group, lecturer and
 * expected size; a unit code alone could never identify the assignment.
 */
async function loadTeachingOptions(semester: number): Promise<DraftTeachingOption[]> {
  const teachings = await prisma.teaching.findMany({
    where: { unit: { is: { semester, scheduled: true } } },
    select: {
      id: true,
      expectedSize: true,
      unit: { select: { code: true } },
      lecturer: { select: { user: { select: { name: true } } } },
      group: { select: { name: true } },
    },
    orderBy: [{ unit: { code: "asc" } }, { group: { name: "asc" } }],
  });

  return teachings.map((teaching) => ({
    id: teaching.id,
    label: `${teaching.unit.code} · ${teaching.group.name} · ${teaching.lecturer.user.name} · ${teaching.expectedSize} students`,
  }));
}

export default async function OfficerDraftPage({ searchParams }: PageProps) {
  // FIRST line of logic: page-entry authorisation.
  const user = await requireAction("EDIT_DRAFT");

  // Next.js 15: searchParams is a Promise. The version key is untrusted
  // browser input; only an exact match against a stored DRAFT id is used.
  const params = await searchParams;
  const requestedVersion =
    typeof params.version === "string" ? params.version.trim() : "";

  // The thin read behind the page guard: which versions can be edited at all.
  const drafts = await prisma.timetableVersion.findMany({
    where: { status: "DRAFT" },
    select: { id: true, semester: true },
    orderBy: { id: "asc" },
  });

  const selectedId =
    requestedVersion !== "" && drafts.some((draft) => draft.id === requestedVersion)
      ? requestedVersion
      : (drafts[0]?.id ?? "");
  const requestedMissing =
    requestedVersion !== "" && !drafts.some((draft) => draft.id === requestedVersion);

  // Only a session `GENERATE_TIMETABLE` allows sees these controls; the
  // accepted action decides the same permission again on every call. The
  // decision is the pure domain function, run here on the server — a page may
  // not call a function exported from a "use client" module, and Next.js also
  // refuses extra named exports from a page file.
  const canGenerate = decideAccess(user, "GENERATE_TIMETABLE").status === "ALLOW";

  if (drafts.length === 0) {
    // Generating is the only way to create a first draft, so the form must
    // render here — but there is nothing to edit until one exists.
    return (
      <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-bold text-slate-800">Draft editor</h1>
          <p className="mt-1 text-sm text-slate-600">
            No draft version exists yet, so there is nothing to edit. Generate
            one below: pick a semester and whether to carry locked rows over
            from an existing draft.
          </p>
          {canGenerate ? (
            <DraftGenerateForm sources={[]} defaultSemester={1} />
          ) : (
            <p className="mt-6 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
              A timetabling officer creates the first draft. Your account can
              open this page but cannot generate, so no draft appears yet.
            </p>
          )}
        </div>
      </main>
    );
  }

  const [result, venues] = await Promise.all([
    loadDraftForValidation(createDraftValidationStore(), user, selectedId),
    loadVenueRecords(),
  ]);
  const venueOptions = venues
    .filter((venue) => venue.status === "ACTIVE")
    .map((venue) => ({
      id: venue.id,
      code: venue.code,
      type: venue.type,
      capacity: venue.capacity,
    }));
  // Only a draft that actually loaded can receive an entry, so the teaching
  // list is read from the version the loader confirmed — not from the
  // browser's version parameter.
  const teachingOptions = result.ok
    ? await loadTeachingOptions(result.version.semester)
    : [];
  const violationMap = result.ok
    ? mapViolationsToRows(result.validation.violations)
    : new Map<string, string[]>();
  const summary = result.ok ? validationSummary(result.validation) : null;

  const versionPicker = (
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="draft-version" className="text-sm font-medium text-slate-700">
          Draft version
        </label>
        {/* `key` remounts the uncontrolled select: after a client-side
            navigation to the version just generated, React would otherwise
            leave the visible choice on the previously rendered version while
            the editor below already shows the new one. */}
        <select
          key={selectedId}
          id="draft-version"
          name="version"
          defaultValue={selectedId}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {drafts.map((draft) => (
            <option key={draft.id} value={draft.id}>
              {draft.id} · semester {draft.semester}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
      >
        Load draft
      </button>
    </form>
  );

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-bold text-slate-800">Draft editor</h1>
        <p className="mt-1 text-sm text-slate-600">
          Generate a new draft, add a teaching session, or move an entry to a
          new day, time or venue. Conflicts are checked against every hard rule
          as soon as the draft reloads.
        </p>
        {versionPicker}

        {requestedMissing && (
          <p
            role="alert"
            aria-live="assertive"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            {LOADER_REFUSAL_MESSAGES.NOT_DRAFT} Showing “{drafts[0]?.id}” instead.
          </p>
        )}

        {canGenerate && (
          <DraftGenerateForm
            sources={drafts}
            defaultSemester={result.ok ? result.version.semester : (drafts[0]?.semester ?? 1)}
          />
        )}

        {!result.ok && (
          <p
            role="alert"
            aria-live="assertive"
            className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {LOADER_REFUSAL_MESSAGES[result.kind]}
          </p>
        )}

        {result.ok && (
          <>
            <p className="mt-6 text-sm text-slate-600">
              Version {result.version.id} · semester {result.version.semester} ·{" "}
              {result.entries.length} {result.entries.length === 1 ? "entry" : "entries"}
            </p>

            {result.validation.status === "incomplete" && (
              <section
                aria-labelledby="incomplete-notice"
                className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4"
              >
                <h2 id="incomplete-notice" className="text-sm font-semibold text-amber-800">
                  Validation is incomplete — the checks below are provisional
                </h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {result.validation.missingContext.map((missing) => (
                    <li key={`${missing.entryId}-${missing.kind}`}>{missing.message}</li>
                  ))}
                </ul>
              </section>
            )}

            {summary !== null && (
              <p
                className={`mt-4 rounded-md border p-3 text-sm font-semibold ${SUMMARY_CLASSES[summary.tone]}`}
                role="status"
              >
                {summary.text}
              </p>
            )}

            <DraftAddForm
              versionId={result.version.id}
              teachings={teachingOptions}
              venues={venueOptions}
            />

            <DraftTable
              versionId={result.version.id}
              venues={venueOptions}
              entries={result.entries.map((entry) => ({
                id: entry.id,
                unitCode: entry.unitCode,
                venueId: entry.venueId,
                venueCode: entry.venueCode,
                day: entry.day,
                start: entry.start,
                end: entry.end,
                locked: entry.locked,
                violations: violationMap.get(entry.id) ?? [],
              }))}
            />
          </>
        )}
      </div>
    </main>
  );
}
