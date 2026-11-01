import Link from "next/link";
import type { DepartmentRef } from "@/domain/venueRegister";
import { VENUE_STATUSES, VENUE_TYPES } from "@/domain/types";

const FIELD_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

type Selected = {
  type: string;
  ownership: string;
  owner: string;
  minCapacity: string;
  status: string;
  q: string;
};

export function VenueFilterForm({
  departments,
  selected,
}: {
  departments: DepartmentRef[];
  selected: Selected;
}) {
  return (
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
          className={FIELD_CLASS}
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
          className={FIELD_CLASS}
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
          className={FIELD_CLASS}
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
          className={FIELD_CLASS}
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
          className={FIELD_CLASS}
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
          className={FIELD_CLASS}
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
  );
}
