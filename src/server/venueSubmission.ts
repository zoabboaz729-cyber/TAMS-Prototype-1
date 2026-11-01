import type { VenueFormErrors } from "../domain/venueForm";
import type { VenueFormRaw } from "../domain/venueForm";
import type { VenueWriteRequest } from "./venueWrite";

export type VenueFormValues = {
  code: string;
  type: string;
  capacity: string;
  status: string;
  owner: string;
  facilities: string[];
};

export type VenueFormState =
  | { errors: VenueFormErrors; values: VenueFormValues; formError?: string }
  | null;

function stringField(fd: FormData, key: string): string | undefined {
  const value = fd.get(key);
  return typeof value === "string" ? value : undefined;
}

export function venueRequestFromFormData(
  fd: FormData,
):
  | { ok: true; request: VenueWriteRequest; values: VenueFormValues }
  | { ok: false; values: VenueFormValues } {
  const op = stringField(fd, "op");
  const venueId = stringField(fd, "venueId");
  const code = stringField(fd, "code");
  const type = stringField(fd, "type");
  const capacity = stringField(fd, "capacity");
  const status = stringField(fd, "status");
  const owner = stringField(fd, "owner");
  const facilities = fd
    .getAll("facilities")
    .filter((value): value is string => typeof value === "string");

  const values: VenueFormValues = {
    code: code ?? "",
    type: type ?? "",
    capacity: capacity ?? "",
    status: status ?? "",
    owner: owner ?? "",
    facilities,
  };
  const raw: VenueFormRaw = { code, type, capacity, status, owner, facilities };

  if (op !== "CREATE" && op !== "EDIT") {
    return { ok: false, values };
  }

  if (op === "CREATE") {
    return { ok: true, request: { op, raw }, values };
  }

  const trimmedVenueId = venueId?.trim();
  if (
    trimmedVenueId === undefined ||
    trimmedVenueId.length < 1 ||
    trimmedVenueId.length > 100
  ) {
    return { ok: false, values };
  }

  return { ok: true, request: { op, venueId: trimmedVenueId, raw }, values };
}
