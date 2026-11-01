import { VenueInputSchema } from "./venueSchema";
import type { VenueInput } from "./venueSchema";
import { VENUE_TYPES } from "./types";

export const SHARED_OWNER_VALUE = "__SHARED__";

export type VenueFormRaw = {
  code?: unknown;
  type?: unknown;
  capacity?: unknown;
  facilities?: unknown;
  status?: unknown;
  owner?: unknown;
};

export type VenueFormErrors = Partial<
  Record<"code" | "type" | "capacity" | "facilities" | "status" | "owner", string>
>;

export type VenueFormResult =
  | { ok: true; value: VenueInput }
  | { ok: false; errors: VenueFormErrors };

const CAPACITY_ERROR = "Capacity must be a whole number from 1 to 1000";
const FACILITIES_ERROR = "Invalid facilities";
const OWNER_ERROR = "Choose an owner or Shared";

const CODE_REQUIRED = "Venue code is required";
const TYPE_INVALID = "Choose a valid venue type";
const STATUS_INVALID = "Choose a valid status";

export function parseVenueForm(raw: VenueFormRaw): VenueFormResult {
  const input =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as VenueFormRaw)
      : ({} as VenueFormRaw);

  const preErrors: VenueFormErrors = {};

  // code: HTML forms send strings; missing or non-string means not supplied.
  let code: string | undefined;
  if (typeof input.code === "string") {
    code = input.code;
  } else {
    preErrors.code = CODE_REQUIRED;
    code = undefined;
  }

  // type: must be a known venue type.
  let type: string | undefined;
  if (typeof input.type === "string" && (VENUE_TYPES as readonly string[]).includes(input.type)) {
    type = input.type;
  } else {
    preErrors.type = TYPE_INVALID;
    type = undefined;
  }

  // capacity: missing or invalid -> one message (handled here, in one place).
  let capacity: number | undefined;
  if (typeof input.capacity === "string" && /^\d{1,4}$/.test(input.capacity)) {
    capacity = Number(input.capacity);
  } else {
    preErrors.capacity = CAPACITY_ERROR;
    capacity = undefined;
  }

  // facilities
  let facilities: string[] | undefined;
  if (input.facilities === undefined) {
    facilities = [];
  } else if (typeof input.facilities === "string") {
    facilities = [input.facilities];
  } else if (
    Array.isArray(input.facilities) &&
    input.facilities.every((item) => typeof item === "string")
  ) {
    facilities = input.facilities as string[];
  } else {
    preErrors.facilities = FACILITIES_ERROR;
    facilities = undefined;
  }

  // owner: explicit sentinel for shared; missing/empty/whitespace/non-string is an error.
  let ownerDepartmentId: string | null | undefined;
  if (typeof input.owner === "string") {
    if (input.owner === SHARED_OWNER_VALUE) {
      ownerDepartmentId = null;
    } else {
      const trimmed = input.owner.trim();
      if (trimmed.length === 0) {
        preErrors.owner = OWNER_ERROR;
        ownerDepartmentId = undefined;
      } else {
        ownerDepartmentId = trimmed;
      }
    }
  } else {
    preErrors.owner = OWNER_ERROR;
    ownerDepartmentId = undefined;
  }

  // status: missing defaults to ACTIVE; invalid values error.
  let status: string | undefined;
  if (input.status === undefined) {
    status = undefined; // schema default applies
  } else if (
    typeof input.status === "string" &&
    ["ACTIVE", "INACTIVE", "MAINTENANCE"].includes(input.status)
  ) {
    status = input.status;
  } else {
    preErrors.status = STATUS_INVALID;
    status = undefined;
  }

  const assembled: {
    code?: unknown;
    type?: unknown;
    capacity?: unknown;
    facilities?: unknown;
    status?: unknown;
    ownerDepartmentId?: unknown;
  } = {
    code,
    type,
    status,
  };
  if (capacity !== undefined) assembled.capacity = capacity;
  if (facilities !== undefined) assembled.facilities = facilities;
  if (ownerDepartmentId !== undefined) assembled.ownerDepartmentId = ownerDepartmentId;

  const parsed = VenueInputSchema.safeParse(assembled);

  if (parsed.success && Object.keys(preErrors).length === 0) {
    return { ok: true, value: parsed.data };
  }

  // Collect schema errors, first message per field. Code length/characters and
  // capacity range and facilities messages come from the schema as-is; code
  // missing and type/status invalid are replaced by the plain-language messages.
  const schemaErrors: VenueFormErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? String(issue.path[0]) : "";
      const field =
        path === "ownerDepartmentId" ? "owner" : (path as keyof VenueFormErrors);
      if (
        field === "code" ||
        field === "type" ||
        field === "capacity" ||
        field === "facilities" ||
        field === "status" ||
        field === "owner"
      ) {
        if (schemaErrors[field] === undefined) {
          if (field === "code") {
            // Preserve length/character messages when a string was supplied.
            if (typeof input.code !== "string") {
              schemaErrors[field] = CODE_REQUIRED;
            } else {
              schemaErrors[field] = issue.message;
            }
          } else if (field === "type") {
            schemaErrors[field] = TYPE_INVALID;
          } else if (field === "status") {
            schemaErrors[field] = STATUS_INVALID;
          } else {
            schemaErrors[field] = issue.message;
          }
        }
      }
    }
  }

  const errors = { ...schemaErrors, ...preErrors };

  if (Object.keys(errors).length === 0) {
    return { ok: true, value: parsed.data as VenueInput };
  }
  return { ok: false, errors };
}