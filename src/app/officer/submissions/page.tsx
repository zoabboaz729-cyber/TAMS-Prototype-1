import { buildSubmissionRows, summariseTeaching } from "@/domain/submissionView";
import { loadDepartments } from "@/server/venueData";
import {
  loadSubmissionRecords,
  loadTeachingRecords,
} from "@/server/submissionData";
import { requireAnyAction } from "@/server/guards";

const STATUS_CLASSES = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-green-200 bg-green-50 text-green-800",
} as const;

export default async function OfficerSubmissionsPage() {
  const user = await requireAnyAction("VIEW_SUBMISSIONS");

  const [records, departments] = await Promise.all([
    loadSubmissionRecords(),
    loadDepartments(),
  ]);
  const rows = buildSubmissionRows(records, departments, user, "OVERVIEW");
  const submissions = await Promise.all(
    rows.map(async (row) => {
      const teaching = await loadTeachingRecords(row.departmentId, row.semester);
      return { row, teaching, summary: summariseTeaching(teaching) };
    }),
  );

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-bold text-slate-800">
          Department submissions overview
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Read-only overview of submission progress across all departments.
        </p>

        {submissions.length === 0 ? (
          <p className="mt-6 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No departments have created submissions yet.
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            {submissions.map(({ row, teaching, summary }) => (
              <section
                key={row.id}
                aria-labelledby={`submission-${row.id}`}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2
                      id={`submission-${row.id}`}
                      className="text-lg font-semibold text-slate-800"
                    >
                      {row.departmentName} · {row.semesterLabel}
                    </h2>
                    <span
                      className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[row.statusTone]}`}
                    >
                      {row.statusLabel}
                    </span>
                  </div>
                </div>

                {row.note && (
                  <p className="mt-4 text-sm text-slate-700">
                    <span className="font-semibold">
                      {row.status === "RETURNED" ? "Return reason" : "Submission note"}:
                    </span>{" "}
                    {row.note}
                  </p>
                )}
                {row.reviewerName && (
                  <p className="mt-2 text-sm text-slate-600">
                    Reviewer: {row.reviewerName}
                  </p>
                )}

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h3 className="font-semibold text-slate-800">
                    Scheduled teaching
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {summary.count} teaching{" "}
                    {summary.count === 1 ? "assignment" : "assignments"} ·{" "}
                    {summary.hoursPerWeek} hours per week
                  </p>
                  {teaching.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">
                      No scheduled teaching records for this semester.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-100">
                      {teaching.map((record) => (
                        <li key={record.id} className="py-3 text-sm">
                          <p className="font-medium text-slate-800">
                            {record.unitCode} — {record.unitTitle}
                          </p>
                          <p className="mt-1 text-slate-600">
                            Group: {record.groupName} · Lecturer:{" "}
                            {record.lecturerName}
                          </p>
                          <p className="mt-1 text-slate-600">
                            {record.sessionsPerWeek} sessions per week ·{" "}
                            {record.sessionLength} hours per session · Expected
                            group size: {record.expectedSize}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
