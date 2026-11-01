import type { AccessDecision } from "./access";
import type { Actor } from "./permissions";
import { canAct } from "./permissions";
import type { VenueStatus, VenueType } from "./types";

/**
 * Venue write-authorisation rules for Kisii University TAMS (PROTOTYPE_SPEC §6 & §8).
 * Pure domain logic: no database, network, Next.js, or clock. Deny by default, never throws.
 *
 * Write access requires the actor to hold the relevant permission over EVERY owner involved:
 * the current owner (EDIT only) and the proposed owner. A null owner means a shared venue
 * and requires MANAGE_SHARED_VENUES; a department id requires DECLARE_VENUE scoped to that
 * department. No role names are hard-coded here - every decision goes through canAct().
 */

/** A venue record as far as write rules are concerned: only its owning department matters. */
export type VenueTarget = { ownerDepartmentId: string | null };

export type VenueOperation = "CREATE" | "EDIT";

/**
 * Decide whether `actor` may perform `op` on a venue.
 *
 * Rules:
 *  - actor === null                              -> UNAUTHENTICATED
 *  - CREATE with a non-null current, or EDIT with
 *    a null current                              -> FORBIDDEN (operation/target mismatch)
 *  - permission check fails for the proposed
 *    owner, or for the current owner (EDIT only) -> FORBIDDEN
 *  - otherwise                                   -> ALLOW
 *
 * canAct() never throws, so decideVenueWrite() never throws either.
 */
export function decideVenueWrite(
  actor: Actor | null,
  op: VenueOperation,
  current: VenueTarget | null,
  proposedOwnerDepartmentId: string | null,
): AccessDecision {
  if (actor === null) {
    return { status: "UNAUTHENTICATED" };
  }

  if (op === "CREATE" && current !== null) {
    return { status: "FORBIDDEN" };
  }
  if (op === "EDIT" && current === null) {
    return { status: "FORBIDDEN" };
  }

  // The actor needs permission over every owner involved: the proposed owner,
  // plus the current owner when editing an existing venue.
  const owners: (string | null)[] = [proposedOwnerDepartmentId];
  if (op === "EDIT" && current !== null) {
    owners.push(current.ownerDepartmentId);
  }

  for (const owner of owners) {
    const permitted =
      owner === null
        ? canAct(actor, "MANAGE_SHARED_VENUES")
        : canAct(actor, "DECLARE_VENUE", { departmentId: owner });
    if (!permitted) {
      return { status: "FORBIDDEN" };
    }
  }

  return { status: "ALLOW" };
}

/** Filters for the venue register list. Missing filters are ignored; all present filters combine with AND. */
export type VenueFilter = {
  type?: VenueType;
  ownership?: "ALL" | "SHARED" | "OWNED";
  ownerDepartmentId?: string;
  minCapacity?: number;
  status?: VenueStatus;
  text?: string;
};

/**
 * Filter venues purely. Does not mutate the input, keeps the input order,
 * and combines all given filters with AND. `text` matches the venue code
 * case-insensitively (substring). `ownership` "ALL" or undefined means no
 * ownership filter.
 */
export function filterVenues<
  T extends {
    code: string;
    type: string;
    capacity: number;
    ownerDepartmentId: string | null;
    status: string;
  },
>(venues: T[], filter: VenueFilter): T[] {
  const { type, ownership, ownerDepartmentId, minCapacity, status, text } = filter;
  const textLower = text === undefined ? undefined : text.toLowerCase();

  return venues.filter((venue) => {
    if (type !== undefined && venue.type !== type) return false;

    if (ownership !== undefined && ownership !== "ALL") {
      const isShared = venue.ownerDepartmentId === null;
      const matchesShared = ownership === "SHARED" && isShared;
      const matchesOwned = ownership === "OWNED" && !isShared;
      if (!matchesShared && !matchesOwned) return false;
    }

    if (ownerDepartmentId !== undefined && venue.ownerDepartmentId !== ownerDepartmentId)
      return false;

    if (minCapacity !== undefined && venue.capacity < minCapacity) return false;

    if (status !== undefined && venue.status !== status) return false;

    if (textLower !== undefined && !venue.code.toLowerCase().includes(textLower))
      return false;

    return true;
  });
}
