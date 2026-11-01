import Link from "next/link";
import type { VenueRow } from "@/domain/venueRegister";

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

export function VenueTable({ rows }: { rows: VenueRow[] }) {
  return (
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
          {rows.length === 0 ? (
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
            rows.map((row) => (
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
                    <span className="inline-flex items-center gap-2">
                      <span className="text-green-700">You can edit</span>
                      <Link
                        href={`/venues/${encodeURIComponent(row.id)}/edit`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        Edit
                      </Link>
                    </span>
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
  );
}
