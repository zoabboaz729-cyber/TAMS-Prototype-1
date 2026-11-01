import { SHARED_OWNER_VALUE } from "@/domain/venueForm";
import { parseJsonFacilities } from "@/domain/types";
import type { VenueFormValues } from "./venueSubmission";

export type VenueNotice = {
  tone: "success" | "info" | "warning";
  text: string;
};

const VENUE_NOTICES = {
  created: { tone: "success", text: "Venue created." },
  updated: { tone: "success", text: "Venue updated." },
  unchanged: { tone: "info", text: "No changes were made." },
  not_found: { tone: "warning", text: "That venue could not be found." },
} satisfies Record<string, VenueNotice>;

export function emptyVenueFormValues(defaultOwner: string): VenueFormValues {
  return {
    code: "",
    type: "ROOM",
    capacity: "",
    status: "ACTIVE",
    owner: defaultOwner,
    facilities: [],
  };
}

export function venueFormValuesFromStored(v: {
  code: string;
  type: string;
  capacity: number;
  ownerDepartmentId: string | null;
  facilities: string;
  status: string;
}): VenueFormValues {
  return {
    code: v.code,
    type: v.type,
    capacity: String(v.capacity),
    status: v.status,
    owner:
      v.ownerDepartmentId === null
        ? SHARED_OWNER_VALUE
        : v.ownerDepartmentId,
    facilities: parseJsonFacilities(v.facilities),
  };
}

export function venueNoticeFor(
  value: string | string[] | undefined,
): VenueNotice | null {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(VENUE_NOTICES, value)
  ) {
    return null;
  }
  return VENUE_NOTICES[value as keyof typeof VENUE_NOTICES];
}
