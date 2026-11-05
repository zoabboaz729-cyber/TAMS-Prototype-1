"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYS, type Day } from "@/domain/types";
import { addDraftEntryAction } from "@/app/officer/draft/actions";
import type { DraftAddResult } from "@/server/draftAdd";
import type { DraftVenueOption } from "./DraftTable";

/**
 * Add-entry form for the officer draft editor (M3-T2b3c).
 *
 * Submits to the accepted `addDraftEntryAction`, which forwards to
 * `performDraftAdd` — the EDIT_DRAFT authorization, semantic validation and
 * transactional DRAFT re-check all live there, so nothing is duplicated in
 * this component. Only the teaching, venue, day, start and end are sent; the
 * version id comes from server props (never a form field the officer can
 * edit) and no actor id, role, locked flag or entry id crosses this boundary.
 *
 * A successful add means only that the row was created. It is never read as
 * "conflict-free": after `ok` or `STALE` the client calls router.refresh(),
 * the page re-runs loadDraftForValidation() and the validator's fresh outcome
 * decides what the officer sees (requirement #9).
 */

export type DraftTeachingOption = {
  /** The real Teaching.id — never a unit code, since one unit can have
   *  several teaching assignments. */
  id: string;
  label: string;
};

type DraftAddFormProps = {
  /** Selected DRAFT version id, from server props. Not user-editable. */
  versionId: string;
  teachings: DraftTeachingOption[];
  venues: DraftVenueOption[];
};

type AddFailure = Exclude<DraftAddResult, { ok: true }>;

/** Fixed copy per typed refusal kind; INVALID_INPUT carries the service's own
 *  plain-language message, which is generated from fixed strings. */
function addFailureMessage(result: AddFailure): string {
  switch (result.kind) {
    case "INVALID_INPUT":
      return result.message;
    case "STALE":
      return "The draft version changed while this entry was being added (it may have been published or removed), so nothing was added. The draft below has been reloaded — check it and try again.";
    case "NOT_DRAFT":
      return "That version is no longer an editable draft, so no entry was added. Pick a draft version above.";
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in again and try again.";
    case "FORBIDDEN":
      return "You are not allowed to add draft entries.";
    case "VERSION_NOT_FOUND":
      return "That draft version no longer exists. Reload the page and pick a version.";
    case "TEACHING_NOT_FOUND":
      return "The chosen teaching assignment no longer exists. Pick another teaching.";
    case "VENUE_NOT_FOUND":
      return "The chosen venue no longer exists. Pick another venue.";
    case "INTERNAL_ERROR":
      return "The entry could not be added. Please try again.";
  }
}

const DAY_LABELS: Record<Day, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100";

export function DraftAddForm({ versionId, teachings, venues }: DraftAddFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teachingId, setTeachingId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [day, setDay] = useState<Day>("MON");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  function submit() {
    // Nothing chosen yet — refuse locally so no pointless write is attempted.
    // The day/time/id rules themselves stay in performDraftAdd.
    if (teachingId === "" || venueId === "") {
      setFeedback({
        tone: "error",
        text: "Choose the teaching assignment and the venue before adding the entry.",
      });
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await addDraftEntryAction({
          versionId,
          teachingId,
          venueId,
          day,
          start,
          end,
        });
        if (result.ok) {
          // The row was created — that says nothing about conflicts. Only the
          // reloaded draft and its fresh validation can report those.
          setFeedback({
            tone: "ok",
            text: "Entry added. Re-checking the draft…",
          });
          router.refresh();
          return;
        }
        if (result.kind === "STALE") {
          router.refresh();
        }
        setFeedback({ tone: "error", text: addFailureMessage(result) });
      } catch (error) {
        console.error(
          "[officer/draft] add request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        setFeedback({
          tone: "error",
          text: "The entry could not be added. Please try again.",
        });
      }
    });
  }

  return (
    <section
      aria-labelledby="draft-add-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <h2 id="draft-add-heading" className="text-sm font-semibold text-slate-800">
        Add a teaching session to version {versionId}
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        One session per submission. Conflicts are not checked here — after the
        entry is saved the draft reloads and the validator reports every hard
        violation it finds.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="add-teaching" className="text-sm font-medium text-slate-700">
            Teaching assignment
          </label>
          <select
            id="add-teaching"
            value={teachingId}
            onChange={(event) => setTeachingId(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Choose a teaching assignment</option>
            {teachings.map((teaching) => (
              <option key={teaching.id} value={teaching.id}>
                {teaching.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="add-venue" className="text-sm font-medium text-slate-700">
            Venue
          </label>
          <select
            id="add-venue"
            value={venueId}
            onChange={(event) => setVenueId(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Choose a venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.code} ({venue.type}, {venue.capacity} seats)
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="add-day" className="text-sm font-medium text-slate-700">
            Teaching day
          </label>
          <select
            id="add-day"
            value={day}
            onChange={(event) => setDay(event.target.value as Day)}
            disabled={pending}
            className={inputClass}
          >
            {DAYS.map((option) => (
              <option key={option} value={option}>
                {DAY_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="add-start" className="text-sm font-medium text-slate-700">
            Start time
          </label>
          <input
            id="add-start"
            type="time"
            step={60}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="add-end" className="text-sm font-medium text-slate-700">
            End time
          </label>
          <input
            id="add-end"
            type="time"
            step={60}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add entry"}
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
    </section>
  );
}
