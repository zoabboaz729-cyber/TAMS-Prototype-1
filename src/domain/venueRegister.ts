import { Actor } from "./permissions";
import { decideVenueWrite } from "./venueRules";
import { venueOwnership } from "./venueSchema";
import { parseJsonFacilities } from "./types";

/**
 * Venue register read-models for Kisii University TAMS (PROTOTYPE_SPEC §6).
 * Pure domain logic: turns stored venue records into display rows, decides
 * the per-row edit hint, and summarises ownership.
 * No database, network, Next.js, or clock. Never throws.
 *
 * The edit hint is computed with decideVenueWrite so the UI hint and the
 * server-side write rule can never disagree.
 */

export type VenueRecord = {
  id: string;
  code: string;
  type: string;
  capacity: number;
  ownerDepartmentId: string | null;
  // facilities is the stored JSON string (SQLite stores lists as JSON text)
  facilities: string;
  status: string;
};

export type DepartmentRef = { id: string; name: string };

export type VenueRow = {
  id: string;
  code: string;
  type: string;
  capacity: number;
  facilities: string[];
  status: string;
  ownerDepartmentId: string | null;
  ownerName: string;
  ownership: "SHARED" | "OWNED";
  canEdit: boolean;
};

function ownerNameFor(
  ownerDepartmentId: string | null,
  departments: DepartmentRef[],
): string {
  if (ownerDepartmentId === null) return "Shared (no owner)";
  const department = departments.find(
    (department) => department.id === ownerDepartmentId,
  );
  return department === undefined ? "Unknown department" : department.name;
}

/**
 * Build display rows for the venue register. Rows are sorted by code with a
 * plain locale-independent string comparison. The input array is not mutated.
 */
export function buildVenueRows(
  venues: VenueRecord[],
  departments: DepartmentRef[],
  actor: Actor | null,
): VenueRow[] {
  return [...venues]
    .map((venue) => {
      const facilities = parseJsonFacilities(venue.facilities);
      const ownership = venueOwnership(venue.ownerDepartmentId);
      return {
        id: venue.id,
        code: venue.code,
        type: venue.type,
        capacity: venue.capacity,
        facilities,
        status: venue.status,
        ownerDepartmentId: venue.ownerDepartmentId,
        ownerName: ownerNameFor(venue.ownerDepartmentId, departments),
        ownership,
        canEdit:
          decideVenueWrite(actor, "EDIT", {
            ownerDepartmentId: venue.ownerDepartmentId,
          }, venue.ownerDepartmentId).status === "ALLOW",
      };
    })
    .sort(
      (a, b) =>
        a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
    );
}

export type VenueSummary = {
  total: number;
  shared: number;
  owned: number;
  byOwner: { departmentId: string; name: string; count: number }[];
};

/**
 * Summarise venue rows. byOwner lists every department passed in (including
 * departments with 0 venues), sorted by name.
 */
export function summariseVenues(
  rows: VenueRow[],
  departments: DepartmentRef[],
): VenueSummary {
  const byOwner = [...departments]
    .map((department) => ({
      departmentId: department.id,
      name: department.name,
      count: rows.filter(
        (row) => row.ownerDepartmentId === department.id,
      ).length,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    total: rows.length,
    shared: rows.filter((row) => row.ownership === "SHARED").length,
    owned: rows.filter((row) => row.ownership === "OWNED").length,
    byOwner,
  };
}
