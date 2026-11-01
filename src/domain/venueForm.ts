import { z } from "zod";
import { VenueInputSchema } from "./venueSchema";
import type { VenueInput } from "./venueSchema";

export const SHARED_OWNER_VALUE = "__SHARED__";

export type VenueFormRaw = {
  code?: unknown;
  type?: unknown;
  capacity?: unknown;
  facilities?: unknown;
  status?: unknown;
  owner?: unknown;
};

export type VenueFormResult =
  | { ok: true; value: VenueInput }
  | {
      ok: false;
      errors: Partial<
        Record<"code" | "type" | "capacity" | "facilities" | "status" | "owner", string>
      >;
    };

const CAPACITY_ERROR = "Capacity must be a whole number from 1 to 1000";
const FACILITIES_ERROR = "Invalid facilities";
const OWNER_ERROR = "Choose an owner or Shared";

export function parseVenueForm(raw: VenueFormRaw): VenueFormResult {
  const input =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as VenueFormRaw)
      : ({} as VenueFormRaw);

  const preErrors: Partial<
    Record<"code" | "type" | "capacity" | "facilities" | "status" | "owner", string>
  > = {};

  // code, type, status: only strings pass through; anything else becomes undefined.
  const code = typeof input.code === "string" ? input.code : undefined;
  const type = typeof input.type === "string" ? input.type : undefined;
  const status = typeof input.status === "string" ? input.status : undefined;

  // capacity: only a 1-4 digit string is converted.
  let capacity: number | undefined;
  if (typeof input.capacity === "string" && /^\d{1,4}$/.test(input.capacity)) {
    capacity = Number(input.capacity);
  } else if (input.capacity !== undefined) {
    // Any other value (including non-string, bad string) is an error.
    preErrors.capacity = CAPACITY_ERROR;
  } else {
    // missing -> undefined, schema reports error; but spec says capacity required.
    // Keep undefined so schema can report; no pre-error message beyond schema.
  }
  // If capacity missing, we still want an error message? The test {} expects capacity error.
  // Schema will report "Required"/expected number. But to be consistent, treat missing as error too?
  if (input.capacity === undefined) {
    preErrors.capacity = CAPACITY_ERROR;
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

  // owner
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
  if (input.owner === undefined) {
    // already caught by non-string branch? input.owner undefined -> else branch sets error. yes.
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

  // Collect schema errors, first message per field.
  const schemaErrors: Partial<
    Record<"code" | "type" | "capacity" | "facilities" | "status" | "owner", string>
  > = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? String(issue.path[0]) : "";
      const field =
        path === "ownerDepartmentId" ? "owner" : (path as keyof typeof schemaErrors);
      if (
        field === "code" ||
        field === "type" ||
        field === "capacity" ||
        field === "facilities" ||
        field === "status" ||
        field === "owner"
      ) {
        if (schemaErrors[field] === undefined) {
          schemaErrors[field] = issue.message;
        }
      }
    }
  }

  // Merge: pre-errors take precedence.
  const errors = { ...schemaErrors, ...preErrors };

  if (Object.keys(errors).length === 0) {
    // Should not happen, but keep type safety.
    return { ok: true, value: parsed.data as VenueInput };
  }
  return { ok: false, errors };
}
