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
import { VENUE_STATUSES, VENUE_TYPES } from "@/domain/types";
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
function ownershipBadge(ownership: "SHARED" | "OWNED") {
  return ownership === "SHARED" ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
      Shared
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800">
      Owned
    </span>
  );
}
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
        <h1 className="text-xl font-bold text-slate-800">Venue register</h1>
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
        <form
          method="GET"
          action="/venues"
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div className="col-span-1 sm:col-span-2">
            <label htmlFor="type" className="block text-xs font-medium text-slate-700 mb-1">
              Type
            </label>
            <select
              id="type"
              name="type"
              defaultValue={selected.type}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All</option>
              {VENUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ownership" className="block text-xs font-medium text-slate-700 mb-1">
              Ownership
            </label>
            <select
              id="ownership"
              name="ownership"
              defaultValue={selected.ownership}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All</option>
              <option value="SHARED">Shared</option>
              <option value="OWNED">Owned</option>
            </select>
          </div>
          <div>
            <label htmlFor="owner" className="block text-xs font-medium text-slate-700 mb-1">
              Owner
            </label>
            <select
              id="owner"
              name="owner"
              defaultValue={selected.owner}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="minCapacity" className="block text-xs font-medium text-slate-700 mb-1">
              Min capacity
            </label>
            <input
              id="minCapacity"
              name="minCapacity"
              type="number"
              min="1"
              max="1000"
              defaultValue={selected.minCapacity}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-xs font-medium text-slate-700 mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={selected.status}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All</option>
              {VENUE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="q" className="block text-xs font-medium text-slate-700 mb-1">
              Search code
            </label>
            <input
              id="q"
              name="q"
              type="text"
              maxLength={20}
              placeholder="Search code"
              defaultValue={selected.q}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="col-span-1 sm:col-span-2 flex flex-col sm:flex-row gap-2 pt-8 sm:pt-0">
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              Filter
            </button>
            <Link
              href="/venues"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              Clear filters
            </Link>
          </div>
        </form>
        {/* Table: scrolls horizontally on small screens. */}
        <div className="mt-6 overflow-x-auto border border-slate-200 rounded-md shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Code
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Capacity
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Facilities
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Ownership
                </th>
                <th className="h-11 px-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Your access
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td className="h-11 px-4 text-center text-slate-500" colSpan={8}>
                    No venues match these filters.{" "}
                    <Link
                      href="/venues"
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      Clear filters
                    </Link>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.code} className="hover:bg-slate-50">
                    <td className="h-11 px-4 font-medium text-slate-900">
                      {row.code}
                    </td>
                    <td className="h-11 px-4 text-slate-700">{row.type}</td>
                    <td className="h-11 px-4 text-slate-700">
                      {row.capacity}
                    </td>
                    <td className="h-11 px-4 text-slate-700">
                      {row.facilities.join(", ") || "None"}
                    </td>
                    <td className="h-11 px-4 text-slate-700">{row.status}</td>
                    <td className="h-11 px-4 text-slate-700">{row.ownerName}</td>
                    <td className="h-11 px-4">{ownershipBadge(row.ownership)}</td>
                    <td className="h-11 px-4">
                      {row.canEdit ? (
                        <span className="text-green-700">You can edit</span>
                      ) : (
                        <span className="text-slate-500">Read only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}