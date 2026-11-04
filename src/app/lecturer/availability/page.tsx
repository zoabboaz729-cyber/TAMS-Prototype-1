import { redirect } from "next/navigation";
import {
  createLecturerAvailabilityStore,
  loadLecturerAvailability,
} from "@/server/lecturerAvailability";
import { requireUser } from "@/server/guards";
import { decideAccess } from "@/domain/access";
import { AvailabilityForm, RemovePeriodButton } from "./AvailabilityForm";

/**
 * Lecturer "My availability" page (M2-T3d).
 *
 * The page guards itself on the server — hiding the menu item is not the
 * protection. Entry requires SET_LECTURER_AVAILABILITY keyed on the session
 * user's own id (SELF scope, lecturers only), so officers/admins — who may
 * READ availability through the service but have no workspace here — are
 * redirected. The read re-checks VIEW with the same subject, so a request
 * for someone else's data cannot be expressed on this page.
 */

const DAY_LABELS = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
} as const;

export default async function LecturerAvailabilityPage() {
  const user = await requireUser();
  const entry = decideAccess(user, "SET_LECTURER_AVAILABILITY", {
    subjectUserId: user.id,
  });
  if (entry.status !== "ALLOW") {
    redirect("/forbidden");
  }

  const result = await loadLecturerAvailability(
    createLecturerAvailabilityStore(),
    user,
    user.id,
  );

  const periods =
    result.ok && result.views.length > 0 ? result.views[0].periods : [];
  const sorted = [...periods].sort(
    (a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start),
  );

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-bold text-slate-800">My availability</h1>
        <p className="mt-1 text-sm text-slate-600">
          Record the weekday periods when you cannot teach. The timetabling
          office uses these to avoid scheduling you into a clash.
        </p>

        <AvailabilityForm />

        <section aria-labelledby="saved-periods-heading" className="mt-8">
          <h2 id="saved-periods-heading" className="text-lg font-semibold text-slate-800">
            Saved unavailable periods
          </h2>
          {sorted.length === 0 ? (
            <p className="mt-3 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
              You have no unavailable periods saved yet. Add one above, for
              example Monday 13:00–14:00.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
              {sorted.map((period) => (
                <li
                  key={period.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <span className="text-sm font-medium text-slate-800">
                    {DAY_LABELS[period.day]} {period.start}–{period.end}
                  </span>
                  <RemovePeriodButton
                    availabilityId={period.id}
                    periodLabel={`${DAY_LABELS[period.day]} ${period.start}–${period.end}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
