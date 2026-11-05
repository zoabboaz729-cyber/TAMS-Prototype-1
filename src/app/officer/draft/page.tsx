/**
 * /officer/draft — officer draft editor (M3-T2b2).
 *
 * Server-rendered view of one DRAFT timetable version: every entry, its
 * resolved unit/venue codes, and the M3 validator's violations shown inline
 * with plain-language messages. Each unlocked row gets a move form whose
 * expected previous schedule comes from this server render, so a stale move
 * is refused by the accepted two-layer compare-and-set (M3-T2b1a).
 *
 * Authorization: requireAction("EDIT_DRAFT") at page entry (ALL-scope for
 * the officer, NONE for every other role) and the loader re-decides EDIT_DRAFT
 * before any read — the layout is not a security boundary.
 *
 * The conflict-free statement is only ever made from a fresh server render:
 * after a successful move the client calls router.refresh(), this page re-runs
 * loadDraftForValidation(), and the outcome below decides what is shown. A
 * move result alone never says the draft is clean (requirement #9).
 */
import { requireAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { createDraftValidationStore } from "@/server/draftStorePrisma";
import { loadDraftForValidation } from "@/server/draftValidation";
import { loadVenueRecords } from "@/server/venueData";
import { DraftTable } from "./DraftTable";
import type { Violation } from "@/domain/validator";

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

function violationsByEntry(violations: readonly Violation[]): Map<string, string[]> {
  const byEntry = new Map<string, string[]>();
  for (const violation of violations) {
    const bucket = byEntry.get(violation.entryId);
    if (bucket === undefined) {
      byEntry.set(violation.entryId, [violation.message]);
    } else {
      bucket.push(violation.message);
    }
  }
  return byEntry;
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

  if (drafts.length === 0) {
    return (
      <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-bold text-slate-800">Draft editor</h1>
          <p className="mt-6 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No draft version exists yet. Drafts are created by the timetable
            generator — Not implemented in prototype (M4-T2).
          </p>
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
  const violationMap = result.ok
    ? violationsByEntry(result.validation.violations)
    : new Map<string, string[]>();

  const versionPicker = (
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="draft-version" className="text-sm font-medium text-slate-700">
          Draft version
        </label>
        <select
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
          Move an entry to a new day, time or venue. Conflicts are checked
          against every hard rule as soon as the draft reloads.
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

            <p
              className={`mt-4 rounded-md border p-3 text-sm font-semibold ${
                result.validation.violations.length === 0
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
              role="status"
            >
              {result.validation.violations.length === 0
                ? "No hard violations in this draft."
                : `${result.validation.violations.length} hard violation${
                    result.validation.violations.length === 1 ? "" : "s"
                  } found — shown on the affected rows below.`}
            </p>

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
