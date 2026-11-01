/**
 * Query-parameter parsing for the venue register list (PROTOTYPE_SPEC §6).
 *
 * Pure domain logic: no database, network, Next.js, or clock. Never throws.
 *
 * Query parameters come from the address bar, so they are parsed leniently:
 * every invalid or unknown value is silently ignored (the key is simply left
 * out), never an error. Repeated keys (array values) are ignored too.
 *
 * ASSUMPTION-8: filter query parameters are optional and free-form text from
 * the browser address bar, so invalid values are dropped rather than surfaced
 * as errors; to be confirmed at the stakeholder walkthrough.
 */
import type { VenueStatus, VenueType } from "./types";
import type { VenueFilter } from "./venueRules";
import { VENUE_STATUSES, VENUE_TYPES } from "./types";

const OWNERSHIP_VALUES = ["ALL", "SHARED", "OWNED"] as const;
const MIN_CAPACITY_REGEX = /^\d{1,4}$/;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 1000;
const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 20;
const MIN_OWNER_LENGTH = 1;
const MAX_OWNER_LENGTH = 100;

/** Read one query value; missing keys and repeated keys (arrays) are ignored. */
function queryString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  if (!Object.hasOwn(params, key)) return undefined;
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse venue register filter query parameters into a VenueFilter containing
 * only the valid keys. Invalid values are silently ignored.
 */
export function parseVenueFilterParams(
  params: Record<string, string | string[] | undefined>,
): VenueFilter {
  const filter: VenueFilter = {};

  const type = queryString(params, "type");
  if (type !== undefined && (VENUE_TYPES as readonly string[]).includes(type)) {
    filter.type = type as VenueType;
  }

  const ownership = queryString(params, "ownership");
  if (
    ownership !== undefined &&
    (OWNERSHIP_VALUES as readonly string[]).includes(ownership)
  ) {
    filter.ownership = ownership as "ALL" | "SHARED" | "OWNED";
  }

  const owner = queryString(params, "owner");
  if (owner !== undefined) {
    const trimmedOwner = owner.trim();
    if (
      trimmedOwner.length >= MIN_OWNER_LENGTH &&
      trimmedOwner.length <= MAX_OWNER_LENGTH
    ) {
      filter.ownerDepartmentId = trimmedOwner;
    }
  }

  const minCapacity = queryString(params, "minCapacity");
  if (minCapacity !== undefined && MIN_CAPACITY_REGEX.test(minCapacity)) {
    const capacity = Number(minCapacity);
    if (capacity >= MIN_CAPACITY && capacity <= MAX_CAPACITY) {
      filter.minCapacity = capacity;
    }
  }

  const status = queryString(params, "status");
  if (status !== undefined && (VENUE_STATUSES as readonly string[]).includes(status)) {
    filter.status = status as VenueStatus;
  }

  const q = queryString(params, "q");
  if (q !== undefined) {
    const trimmedQ = q.trim();
    if (trimmedQ.length >= MIN_TEXT_LENGTH && trimmedQ.length <= MAX_TEXT_LENGTH) {
      filter.text = trimmedQ;
    }
  }

  return filter;
}