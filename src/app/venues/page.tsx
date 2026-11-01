/**
 * /venues — venue register list with GET filters (task M2-T1b3).
 *
 * Async server page. Entry is authorised with requireAnyAction("DECLARE_VENUE")
 * — never requireAction — because DECLARE_VENUE is OWN_DEPARTMENT-scoped for
 * department reps, and requireAction (which needs a resource) would lock them
 * out before they have picked a department. Per-record write permission is
 * shown as a read-only hint (canEdit) and is rechecked in the data-changing
 * action (M2-T1c).
 *
 * No client JavaScript, no create/edit forms, and no unvalidated values are
 * rendered as HTML: React escaping is used throughout.
 */
import Link from "next/link";
import { requireAnyAction } from "@/server/guards";
import { loadDepartments, loadVenueRecords } from "@/server/venueData";
import {
  buildVenueRows,
  summariseVenues,
} from "@/domain/venueRegister";
import { filterVenues } from "@/domain/venueRules";
import { parseVenueFilterParams } from "@/domain/venueFilterParams";
import { ownerOptionsFor } from "@/domain/venueOwnerOptions";
import { VenueFilterForm } from "@/components/venues/VenueFilterForm";
import { VenueTable } from "@/components/venues/VenueTable";
import { venueNoticeFor } from "@/server/venueFormView";

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

type FilterValues = {
  type: string;
  ownership: string;
  owner: string;
  minCapacity: string;
  status: string;
  q: string;
};
export default async function VenuesPage({
  searchParams,
}: PageProps) {
  // FIRST line of logic: page-entry authorisation.
  const user = await requireAnyAction("DECLARE_VENUE");

  // Next.js 15: searchParams is a Promise. Parse it leniently - invalid
  // values are ignored by the parser, never an error.
  const params = await searchParams;
  const filter = parseVenueFilterParams(params);

  const [venues, departments] = await Promise.all([
    loadVenueRecords(),
    loadDepartments(),
  ]);
  const rows = buildVenueRows(venues, departments, user);
  // The summary counts ALL venues, while the table respects the filters.
  const summary = summariseVenues(rows, departments);
  const filtered = filterVenues(rows, filter);
  const notice = venueNoticeFor(params.notice);
  const canCreate = ownerOptionsFor(user, departments, "CREATE", null).length > 0;

  const selected: FilterValues = {
    type: filter.type ?? "",
    ownership: filter.ownership ?? "",
    owner: filter.ownerDepartmentId ?? "",
    minCapacity:
      filter.minCapacity === undefined ? "" : String(filter.minCapacity),
    status: filter.status ?? "",
    q: filter.text ?? "",
  };
  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        {notice && (
          <p
            role="status"
            className={`mb-4 rounded-md border p-3 text-sm ${
              notice.tone === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : notice.tone === "info"
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {notice.text}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-800">Venue register</h1>
          {canCreate && (
            <Link
              href="/venues/new"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              Add venue
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Showing {filtered.length} of {summary.total} venues.
        </p>
        {/* Summary strip: computed from ALL rows, not the filtered ones. */}
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-slate-500">Total</span>
            <span className="font-semibold text-slate-800">{summary.total}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500">Shared</span>
            <span className="font-semibold text-slate-800">{summary.shared}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500">Owned</span>
            <span className="font-semibold text-slate-800">{summary.owned}</span>
          </div>
          {summary.byOwner.map((department) => (
            <div key={department.departmentId} className="flex flex-col gap-1">
              <span className="text-slate-500">{department.name}</span>
              <span className="font-semibold text-slate-800">{department.count}</span>
            </div>
          ))}
        </div>
        {/* Filter form: GET, no data-changing inputs. */}
        <VenueFilterForm departments={departments} selected={selected} />
        {/* Table: scrolls horizontally on small screens. */}
        <VenueTable rows={filtered} />
      </div>
    </main>
  );
}