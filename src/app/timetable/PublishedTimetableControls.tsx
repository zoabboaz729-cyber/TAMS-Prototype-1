/**
 * Read-only perspective selectors for the published timetable page (M4-T4d2).
 *
 * A Server Component: every control is a native GET form that navigates to
 * /timetable, so no client state, handler or dependency is introduced. Each form
 * submits only the fields the accepted read contract understands — `semester`,
 * `view`, `id` — and never a versionId, actor, role or publication field. The
 * current published version is always resolved by the service, never here.
 *
 * Options come from the accepted read-only store's real stored ids and labels
 * (group name, lecturer display name, venue code); nothing is invented and no
 * label is built from an id. The semester form submits only `semester`, which
 * returns the viewer to their role-aware default for that semester; the three
 * perspective forms carry the current semester and a fixed view plus the chosen
 * id. The selected semester and perspective stay visibly identifiable.
 */
import type {
  LecturerChoice,
  StudentGroupChoice,
  VenueChoice,
  ViewingPerspective,
} from "@/server/publishedTimetableContract";

export type PublishedTimetableControlsProps = {
  perspectives: readonly ViewingPerspective[];
  semester: number;
  activeView: ViewingPerspective | null;
  activeId: string | null;
  groups: readonly StudentGroupChoice[];
  lecturers: readonly LecturerChoice[];
  venues: readonly VenueChoice[];
};

type Option = { value: string; label: string };

const VIEW_LABELS: Record<ViewingPerspective, string> = {
  group: "Student group",
  lecturer: "Lecturer",
  venue: "Venue",
};

const LABEL_CLASS = "text-sm font-medium text-slate-700";
const SELECT_CLASS =
  "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const BUTTON_CLASS =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1";
const FORM_CLASS =
  "flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

/** One perspective GET form: hidden semester + view, a labelled id select. */
function PerspectiveForm({
  view,
  semester,
  activeView,
  activeId,
  options,
  submitLabel,
}: {
  view: ViewingPerspective;
  semester: number;
  activeView: ViewingPerspective | null;
  activeId: string | null;
  options: readonly Option[];
  submitLabel: string;
}) {
  const isActive = activeView === view;
  const selectId = `timetable-${view}-id`;
  return (
    <form
      method="get"
      action="/timetable"
      aria-label={`${VIEW_LABELS[view]} timetable selector`}
      className={FORM_CLASS}
    >
      <input type="hidden" name="semester" value={String(semester)} />
      <input type="hidden" name="view" value={view} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={selectId} className={LABEL_CLASS}>
          {VIEW_LABELS[view]}
          {isActive ? " (selected)" : ""}
        </label>
        <select
          id={selectId}
          name="id"
          defaultValue={isActive && activeId !== null ? activeId : undefined}
          className={SELECT_CLASS}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={BUTTON_CLASS}>
        {submitLabel}
      </button>
    </form>
  );
}

export function PublishedTimetableControls({
  perspectives,
  semester,
  activeView,
  activeId,
  groups,
  lecturers,
  venues,
}: PublishedTimetableControlsProps) {
  const groupOptions = groups.map((group) => ({ value: group.id, label: group.name }));
  const lecturerOptions = lecturers.map((lecturer) => ({ value: lecturer.id, label: lecturer.displayName }));
  const venueOptions = venues.map((venue) => ({ value: venue.id, label: venue.code }));
  return (
    <section aria-label="Timetable perspective selectors" className="mt-4 space-y-4">
      <h2 className="text-base font-bold text-slate-800">Choose a timetable</h2>
      <form method="get" action="/timetable" aria-label="Semester selector" className={FORM_CLASS}>
        <div className="flex flex-col gap-1">
          <label htmlFor="timetable-semester" className={LABEL_CLASS}>
            Semester
          </label>
          <select
            id="timetable-semester"
            name="semester"
            defaultValue={String(semester)}
            className={SELECT_CLASS}
          >
            <option value="1">Semester 1</option>
            <option value="2">Semester 2</option>
          </select>
        </div>
        <button type="submit" className={BUTTON_CLASS}>
          Apply semester
        </button>
        <p className="w-full text-xs text-slate-600">
          Changing the semester returns you to your default view for that semester
          (your own group as a student, your own teaching timetable as a lecturer).
        </p>
      </form>
      <div className="grid gap-4 lg:grid-cols-3">
        {perspectives.includes("group") && groups.length > 0 && <PerspectiveForm
          view="group"
          semester={semester}
          activeView={activeView}
          activeId={activeId}
          options={groupOptions}
          submitLabel="Show group timetable"
        />}
        {perspectives.includes("lecturer") && lecturers.length > 0 && <PerspectiveForm
          view="lecturer"
          semester={semester}
          activeView={activeView}
          activeId={activeId}
          options={lecturerOptions}
          submitLabel="Show lecturer timetable"
        />}
        {perspectives.includes("venue") && venues.length > 0 && <PerspectiveForm
          view="venue"
          semester={semester}
          activeView={activeView}
          activeId={activeId}
          options={venueOptions}
          submitLabel="Show venue timetable"
        />}
      </div>
      <p className="text-sm text-slate-700" role="status">
        Selected semester: <span className="font-semibold">Semester {semester}</span>.
        {activeView !== null ? (
          <>
            {" "}Selected perspective: <span className="font-semibold">{VIEW_LABELS[activeView]}</span>.
          </>
        ) : (
          " No perspective is currently displayed."
        )}
      </p>
    </section>
  );
}