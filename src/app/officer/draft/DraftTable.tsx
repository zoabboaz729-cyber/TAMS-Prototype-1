"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYS, type Day } from "@/domain/types";
import { moveDraftEntryAction } from "@/app/officer/draft/actions";
import type { DraftMoveResult } from "@/server/draftMove";

/**
 * Draft editor table (M3-T2b2; form re-sync corrected in M3-T2b2a). Each
 * unlocked row carries a move form; the proposed values are local state, while
 * the expected previous schedule comes from the latest server render (props) —
 * the optimistic-concurrency token is therefore never stale client data the
 * officer edited.
 *
 * After any accepted or stale outcome the client calls router.refresh(), which
 * re-runs the page's loadDraftForValidation(); the conflict summary and the
 * inline violation messages shown to the officer always come from that fresh
 * server validation, never from the move result (requirement #9). A row whose
 * server schedule differs from the one it was rendered with resets its
 * controls to the persisted values.
 */

const DAY_LABELS: Record<Day, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

export type DraftTableRow = {
  id: string;
  unitCode: string | null;
  venueId: string;
  venueCode: string | null;
  day: string;
  start: string;
  end: string;
  locked: boolean;
  /**
   * Plain-language violation messages from the server run. A pairwise clash
   * appears on both affected rows with the validator's original message,
   * deduped — so these strings are unique within one row and safe as keys.
   */
  violations: string[];
};

export type DraftVenueOption = {
  id: string;
  code: string;
  type: string;
  capacity: number;
};

type DraftTableProps = {
  versionId: string;
  entries: DraftTableRow[];
  venues: DraftVenueOption[];
};

type MoveFailure = Exclude<DraftMoveResult, { ok: true }>;

/** Fixed copy per typed refusal kind; INVALID_INPUT carries the server's own
 *  plain-language message, which is generated from fixed strings. */
function moveFailureMessage(result: MoveFailure): string {
  switch (result.kind) {
    case "INVALID_INPUT":
      return result.message;
    case "STALE":
      return "The entry had already changed since this table loaded, so the move was refused and nothing was overwritten. The table below now shows the current schedule — check it and try again.";
    case "ENTRY_LOCKED":
      return "This entry is locked and cannot be moved.";
    case "NOT_DRAFT":
      return "This version is no longer a draft, so its entries can no longer be moved.";
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in again and try again.";
    case "FORBIDDEN":
      return "You are not allowed to move draft entries.";
    case "VERSION_NOT_FOUND":
      return "This draft version no longer exists. Reload the page.";
    case "ENTRY_NOT_FOUND":
      return "This entry no longer exists in the draft. The table has been refreshed.";
    case "ENTRY_WRONG_VERSION":
      return "This entry does not belong to the selected draft version. Reload the page and try again.";
    case "VENUE_NOT_FOUND":
      return "The chosen venue no longer exists. Pick another venue.";
    case "INTERNAL_ERROR":
      return "The move could not be saved. Please try again.";
  }
}

const inputClass =
  "rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100";

function MoveForm({
  versionId,
  entry,
  venues,
}: {
  versionId: string;
  entry: DraftTableRow;
  venues: DraftVenueOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const serverSchedule = `${entry.day}|${entry.start}|${entry.end}|${entry.venueId}`;
  const [day, setDay] = useState(entry.day);
  const [start, setStart] = useState(entry.start);
  const [end, setEnd] = useState(entry.end);
  const [venueId, setVenueId] = useState(entry.venueId);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  // Re-sync the proposed values when the persisted schedule changes (accepted
  // move, or a STALE refusal followed by router.refresh()). Comparing the
  // server schedule during render, rather than in an effect, means an unrelated
  // refresh leaves the officer's in-flight edits untouched — only a real change
  // to this entry's schedule rewrites the controls. The expected* concurrency
  // values still come from props, never from this state.
  const [syncedSchedule, setSyncedSchedule] = useState(serverSchedule);
  if (syncedSchedule !== serverSchedule) {
    setSyncedSchedule(serverSchedule);
    setDay(entry.day);
    setStart(entry.start);
    setEnd(entry.end);
    setVenueId(entry.venueId);
  }

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await moveDraftEntryAction({
          versionId,
          entryId: entry.id,
          day,
          start,
          end,
          venueId,
          // Expected previous schedule: the values this table was rendered
          // with — never the officer's in-flight edits.
          expectedDay: entry.day,
          expectedStart: entry.start,
          expectedEnd: entry.end,
          expectedVenueId: entry.venueId,
        });
        if (result.ok) {
          setFeedback({
            tone: "ok",
            text: "Entry moved. Re-checking the draft…",
          });
          router.refresh();
          return;
        }
        if (result.kind === "STALE") {
          // Bring the row back to the true current schedule so the next
          // attempt carries the right expected values.
          router.refresh();
        }
        setFeedback({ tone: "error", text: moveFailureMessage(result) });
      } catch (error) {
        console.error(
          "[officer/draft] move request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        setFeedback({ tone: "error", text: "The move could not be saved. Please try again." });
      }
    });
  }

  const daySelectId = `move-day-${entry.id}`;
  const startInputId = `move-start-${entry.id}`;
  const endInputId = `move-end-${entry.id}`;
  const venueSelectId = `move-venue-${entry.id}`;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={daySelectId} className="sr-only">
        New day for {entry.unitCode ?? entry.id}
      </label>
      <select
        id={daySelectId}
        value={day}
        onChange={(event) => setDay(event.target.value)}
        disabled={pending}
        className={inputClass}
      >
        {DAYS.map((option) => (
          <option key={option} value={option}>
            {DAY_LABELS[option]}
          </option>
        ))}
        {/* Keep a corrupt stored day visible instead of silently changing it. */}
        {!DAYS.includes(day as Day) && day !== "" && <option value={day}>{day}</option>}
      </select>
      <label htmlFor={startInputId} className="sr-only">
        New start time for {entry.unitCode ?? entry.id}
      </label>
      <input
        id={startInputId}
        type="time"
        step={60}
        value={start}
        onChange={(event) => setStart(event.target.value)}
        disabled={pending}
        className={inputClass}
      />
      <label htmlFor={endInputId} className="sr-only">
        New end time for {entry.unitCode ?? entry.id}
      </label>
      <input
        id={endInputId}
        type="time"
        step={60}
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        disabled={pending}
        className={inputClass}
      />
      <label htmlFor={venueSelectId} className="sr-only">
        New venue for {entry.unitCode ?? entry.id}
      </label>
      <select
        id={venueSelectId}
        value={venueId}
        onChange={(event) => setVenueId(event.target.value)}
        disabled={pending}
        className={inputClass}
      >
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.code} ({venue.type}, {venue.capacity} seats)
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Moving…" : "Move"}
      </button>
      {feedback !== null && (
        <p
          role={feedback.tone === "ok" ? "status" : "alert"}
          aria-live={feedback.tone === "ok" ? "polite" : "assertive"}
          className={`w-full text-xs ${
            feedback.tone === "ok" ? "text-green-700" : "text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}

export function DraftTable({ versionId, entries, venues }: DraftTableProps) {
  if (entries.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
        This draft has no entries yet.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3">Unit</th>
            <th scope="col" className="px-4 py-3">Current schedule</th>
            <th scope="col" className="px-4 py-3">Problems</th>
            <th scope="col" className="px-4 py-3">Move to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {entries.map((entry) => (
            <tr key={entry.id} className={entry.violations.length > 0 ? "bg-red-50/60" : ""}>
              <td className="px-4 py-3 font-medium text-slate-800">
                {entry.unitCode ?? (
                  <span className="text-slate-500">
                    {entry.id} <span className="font-normal">(unit unresolved)</span>
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-700">
                {DAY_LABELS[entry.day as Day] ?? entry.day} {entry.start}–{entry.end} @{" "}
                {entry.venueCode ?? "(unknown venue)"}
                {entry.locked && (
                  <span className="ml-2 inline-flex rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    Locked
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {entry.violations.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <ul className="list-disc space-y-1 pl-4 text-red-700">
                    {entry.violations.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3">
                {entry.locked ? (
                  <p className="text-xs text-slate-500">
                    Locked entries never move (they are kept by the generator, M4-T2).
                  </p>
                ) : (
                  <MoveForm versionId={versionId} entry={entry} venues={venues} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
