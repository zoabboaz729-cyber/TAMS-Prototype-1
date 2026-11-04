"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYS, type Day } from "@/domain/types";
import type { PeriodErrors } from "@/domain/lecturerAvailability";
import {
  addUnavailablePeriodAction,
  removeUnavailablePeriodAction,
} from "@/app/lecturer/availability/actions";

/**
 * Client form + remove button for the lecturer availability page (M2-T3d).
 * Both post to the server actions, which re-enforce authentication,
 * same-origin, permission and ownership — this component only renders the
 * results. Day/start/end are the whole payload; ids never come from here.
 */

const DAY_LABELS: Record<Day, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

type AddFailure = Exclude<Awaited<ReturnType<typeof addUnavailablePeriodAction>>, { ok: true }>;
type RemoveFailure = Exclude<Awaited<ReturnType<typeof removeUnavailablePeriodAction>>, { ok: true }>;

function serverFailureMessage(result: AddFailure | RemoveFailure): string {
  switch (result.kind) {
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in and try again.";
    case "FORBIDDEN":
      return "You are not allowed to change availability. Only your own periods can be changed.";
    case "NO_LECTURER_PROFILE":
      return "Your account has no lecturer profile yet, so periods cannot be saved. Contact the timetabling office.";
    case "NOT_FOUND":
      return "That period no longer exists. Refresh the page to see your current list.";
    case "INTERNAL_ERROR":
      return "The period could not be saved. Please try again.";
    case "INVALID":
    case "DUPLICATE":
    case "OVERLAP":
      return "";
  }
}

export function AvailabilityForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [errors, setErrors] = useState<PeriodErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  function submit() {
    setErrors({});
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await addUnavailablePeriodAction({ day, start, end });
        if (result.ok) {
          setSuccess(
            `Saved: ${DAY_LABELS[result.period.day]} ${result.period.start}–${result.period.end}.`,
          );
          setDay("");
          setStart("");
          setEnd("");
          router.refresh();
          return;
        }
        if (result.kind === "INVALID") {
          setErrors(result.errors);
        } else if (result.kind === "DUPLICATE" || result.kind === "OVERLAP") {
          setErrors({ period: result.message });
        } else {
          setErrors({ period: serverFailureMessage(result) });
        }
      } catch (error) {
        console.error(
          "[lecturer-availability] add request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        setErrors({ period: "The period could not be saved. Please try again." });
      }
    });
  }

  const inputClass =
    "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100";
  const errorClass = "border-red-400 focus:border-red-500 focus:ring-red-500";

  return (
    <section
      aria-labelledby="add-period-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="add-period-heading" className="text-lg font-semibold text-slate-800">
        Add an unavailable period
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Enter a weekday and a time range, for example Monday 13:00 to 14:00.
        Times are 24-hour; the start must be earlier than the end.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="availability-day" className="text-sm font-medium text-slate-700">
            Day
          </label>
          <select
            id="availability-day"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={pending}
            aria-invalid={errors.day !== undefined}
            className={`${inputClass} ${errors.day !== undefined ? errorClass : ""}`}
          >
            <option value="">Select a day</option>
            {DAYS.map((option) => (
              <option key={option} value={option}>
                {DAY_LABELS[option]}
              </option>
            ))}
          </select>
          {errors.day !== undefined && (
            <p className="text-xs text-red-700">{errors.day}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="availability-start" className="text-sm font-medium text-slate-700">
            From
          </label>
          <input
            id="availability-start"
            type="time"
            step={60}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            disabled={pending}
            aria-invalid={errors.start !== undefined}
            className={`${inputClass} ${errors.start !== undefined ? errorClass : ""}`}
          />
          {errors.start !== undefined && (
            <p className="text-xs text-red-700">{errors.start}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="availability-end" className="text-sm font-medium text-slate-700">
            To
          </label>
          <input
            id="availability-end"
            type="time"
            step={60}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            disabled={pending}
            aria-invalid={errors.end !== undefined}
            className={`${inputClass} ${errors.end !== undefined ? errorClass : ""}`}
          />
          {errors.end !== undefined && (
            <p className="text-xs text-red-700">{errors.end}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add period"}
        </button>
      </form>

      {errors.period !== undefined && (
        <p role="alert" aria-live="assertive" className="mt-3 text-sm text-red-700">
          {errors.period}
        </p>
      )}
      {success !== null && (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-green-700">
          {success}
        </p>
      )}
    </section>
  );
}

export function RemovePeriodButton({
  availabilityId,
  periodLabel,
}: {
  availabilityId: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeUnavailablePeriodAction({ availabilityId });
        if (result.ok) {
          router.refresh();
          return;
        }
        if (result.kind === "INVALID" || result.kind === "NOT_FOUND") {
          setError("That period no longer exists. Refresh the page to see your current list.");
        } else {
          setError(serverFailureMessage(result));
        }
      } catch (caught) {
        console.error(
          "[lecturer-availability] remove request failed:",
          caught instanceof Error ? caught.message : "Unknown error",
        );
        setError("The period could not be removed. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Remove ${periodLabel}`}
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error !== null && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
