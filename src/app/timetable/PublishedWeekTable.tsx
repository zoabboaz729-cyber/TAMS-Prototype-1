import type { PlacedSession, PublishedWeekGrid, WeekDay } from "@/domain/publishedWeekGrid";
import type { ViewingPerspective } from "@/server/publishedTimetableContract";

export type PublishedWeekTableProps = {
  grid: PublishedWeekGrid;
  view: ViewingPerspective;
};

const VIEW_LABELS: Record<ViewingPerspective, string> = {
  group: "Student group view",
  lecturer: "Lecturer view",
  venue: "Venue view",
};

const PROTOTYPE_BANNER = "Prototype — sample data. Not official university records.";
const EMPTY_STATE = "This selected timetable contains no sessions.";
const OVERLAP_NOTICE =
  "Overlapping sessions are present in the stored published timetable. Every session remains visible below. A shared time interval alone does not establish a hard-constraint violation.";

function sessionDetails(
  session: PlacedSession,
  view: ViewingPerspective,
): { label: string; value: string }[] {
  switch (view) {
    case "group":
      return [
        { label: "Lecturer", value: session.lecturerName },
        { label: "Venue", value: session.venueCode },
      ];
    case "lecturer":
      return [
        { label: "Student group", value: session.groupName },
        { label: "Venue", value: session.venueCode },
      ];
    case "venue":
      return [
        { label: "Student group", value: session.groupName },
        { label: "Lecturer", value: session.lecturerName },
      ];
  }
}

function sessionStyle(session: PlacedSession) {
  return {
    gridColumn: 2,
    gridRow: `${session.startSlotIndex + 1} / ${session.endSlotIndex + 1}`,
    width: `calc(${100 / session.laneCount}% - 0.5rem)`,
    marginLeft: `calc(${(100 * session.lane) / session.laneCount}% + 0.25rem)`,
  };
}

function coversSlot(session: PlacedSession, slotIndex: number): boolean {
  return session.startSlotIndex <= slotIndex && session.endSlotIndex > slotIndex;
}

function lunchWindow(grid: PublishedWeekGrid): string | null {
  const lunch = grid.slots.filter((slot) => slot.isLunch);
  if (lunch.length === 0) return null;
  return `${lunch[0].start}–${lunch[lunch.length - 1].end}`;
}

function SessionCard({ session, view }: { session: PlacedSession; view: ViewingPerspective }) {
  const overlaps = session.overlappingEntryIds.length > 0;
  return (
    <li
      data-entry-id={session.entryId}
      data-day-index={session.dayIndex}
      data-start-slot-index={session.startSlotIndex}
      data-end-slot-index={session.endSlotIndex}
      data-slot-span={session.slotSpan}
      data-duration-minutes={session.durationMinutes}
      data-lane={session.lane}
      data-lane-count={session.laneCount}
      data-overlapping-entry-ids={session.overlappingEntryIds.join(" ")}
      style={sessionStyle(session)}
      className="relative z-10 my-1 min-w-0 list-none self-stretch rounded-xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50 p-3 shadow-sm"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-700">
        {session.unitCode}
      </p>
      <h4 className="mt-1 break-words text-sm font-semibold leading-snug text-slate-950">
        {session.unitTitle}
      </h4>
      <p className="mt-1 text-xs font-semibold text-cyan-800">
        <span className="sr-only">Start and end time: </span>
        {session.start}–{session.end}
      </p>
      <dl className="mt-2 space-y-1.5">
        {sessionDetails(session, view).map((detail) => (
          <div key={detail.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {detail.label}
            </dt>
            <dd className="break-words text-xs font-bold text-slate-900">{detail.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] font-medium text-slate-600">{session.durationMinutes} minutes</p>
      {overlaps && (
        <p className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
          Time overlap
          <span className="sr-only"> with entry IDs {session.overlappingEntryIds.join(", ")}</span>
        </p>
      )}
    </li>
  );
}

function DayColumn({
  grid,
  day,
  view,
}: {
  grid: PublishedWeekGrid;
  day: WeekDay;
  view: ViewingPerspective;
}) {
  const daySessions = grid.sessions.filter((session) => session.dayIndex === day.index);
  const lanes = daySessions.reduce((max, session) => Math.max(max, session.laneCount), 1);
  const lunch = lunchWindow(grid);
  return (
    <section
      data-day={day.day}
      data-day-index={day.index}
      aria-label={`Teaching day ${day.day}`}
      className="flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      style={{ minWidth: `${4 + lanes * 10.5}rem` }}
    >
      <header className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-cyan-50 px-3 py-3">
        <h3 className="text-base font-bold text-indigo-950">
          <span className="sr-only">Teaching day </span>
          {day.day}
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          {daySessions.length} {daySessions.length === 1 ? "session" : "sessions"}
        </p>
        {lunch !== null && <p className="mt-1 text-xs font-semibold text-amber-900">Lunch break {lunch}</p>}
      </header>
      <ol
        aria-label={`${day.day} sessions in start-time order`}
        className="grid list-none gap-1 p-2"
        style={{
          gridTemplateColumns: "4rem minmax(0, 1fr)",
          gridTemplateRows: `repeat(${grid.slots.length}, minmax(7.5rem, auto))`,
        }}
      >
        {grid.slots.map((slot) => (
          <li
            key={`time-${slot.id}`}
            data-time-slot={slot.id}
            aria-hidden="true"
            style={{ gridColumn: 1, gridRow: slot.index + 1 }}
            className={`flex flex-col items-center justify-center rounded-lg border-r border-indigo-100 pr-1 text-center text-[11px] font-semibold leading-tight ${
              slot.isLunch ? "text-amber-900" : "text-slate-600"
            }`}
          >
            <span>{slot.start}</span>
            <span>–</span>
            <span>{slot.end}</span>
          </li>
        ))}
        {grid.slots.map((slot) => {
          const occupied = daySessions.some((session) => coversSlot(session, slot.index));
          const empty = !slot.isLunch && !occupied;
          return (
            <li
              key={`cell-${slot.id}`}
              data-slot-id={slot.id}
              data-empty-slot={empty ? "true" : undefined}
              data-lunch-slot={slot.isLunch ? "true" : undefined}
              aria-hidden="true"
              style={{ gridColumn: 2, gridRow: slot.index + 1 }}
              className={`flex items-center justify-center rounded-lg border p-2 text-center text-xs ${
                slot.isLunch
                  ? "border-amber-300 bg-amber-100 font-semibold text-amber-950"
                  : empty
                    ? "border-dashed border-slate-300 bg-stone-50 text-slate-600"
                    : "border-slate-100 bg-slate-50"
              }`}
            >
              {slot.isLunch ? "Lunch break" : empty ? "No session" : null}
            </li>
          );
        })}
        {daySessions.map((session) => (
          <SessionCard key={session.entryId} session={session} view={view} />
        ))}
      </ol>
    </section>
  );
}

export function PublishedWeekTable({ grid, view }: PublishedWeekTableProps) {
  const sessionCount = `${grid.sessions.length} ${grid.sessions.length === 1 ? "session" : "sessions"}`;
  const dayCount = `${grid.days.length} teaching ${grid.days.length === 1 ? "day" : "days"}`;
  return (
    <section
      aria-label={`Published weekly timetable — ${VIEW_LABELS[view]}`}
      className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-lg shadow-indigo-950/5"
    >
      <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
        {PROTOTYPE_BANNER}
      </p>
      <header className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-cyan-900 px-4 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">{VIEW_LABELS[view]}</p>
          <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
            Read-only
          </span>
        </div>
        <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">Weekly timetable</h2>
        <p className="mt-2 text-sm text-indigo-100">
          {sessionCount} across {dayCount}. Times use the stored 24-hour schedule.
        </p>
      </header>
      {grid.hasOverlaps && (
        <aside
          aria-label="Timetable data quality notice"
          className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:px-6"
        >
          <h3 className="font-bold">Data quality notice</h3>
          <p className="mt-1">{OVERLAP_NOTICE}</p>
        </aside>
      )}
      {grid.sessions.length === 0 && (
        <section
          aria-label="Empty timetable"
          className="border-b border-cyan-200 bg-cyan-50 px-4 py-4 text-cyan-950 sm:px-6"
        >
          <h3 className="text-sm font-bold">No sessions in this selection</h3>
          <p className="mt-1 text-sm">{EMPTY_STATE}</p>
          <p className="mt-1 text-xs text-cyan-900">
            The teaching days and time intervals below are shown without scheduled sessions.
          </p>
        </section>
      )}
      <div
        role="region"
        aria-label="Weekly timetable; scroll horizontally when the days exceed the available width"
        tabIndex={0}
        className="overflow-x-auto bg-slate-100 p-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:p-4 [scrollbar-color:#4338ca_#e0e7ff] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-indigo-100 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-indigo-700 [&::-webkit-scrollbar-thumb:hover]:bg-cyan-700"
      >
        <div className="flex flex-col gap-4 lg:flex-row">
          {grid.days.map((day) => (
            <DayColumn key={`${day.index}-${day.day}`} grid={grid} day={day} view={view} />
          ))}
        </div>
      </div>
    </section>
  );
}