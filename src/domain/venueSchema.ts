import { z } from "zod";
import { VenueStatusSchema, VenueTypeSchema } from "./types";

/**
 * Venue input validation for Kisii University TAMS (PROTOTYPE_SPEC §6).
 * Pure domain logic: zod schema only - no database, network, or Next.js.
 *
 * ASSUMPTION-4: departments own rooms; rooms with no owning department are shared.
 */

/** The only facility values a venue record may carry (prototype assumption). */
export const ALLOWED_FACILITIES = [
  "projector",
  "computers",
  "whiteboard",
  "accessible",
] as const;
export type AllowedFacility = (typeof ALLOWED_FACILITIES)[number];

export const VenueInputSchema = z
  .object({
    // Trimmed and upper-cased, then checked: 2-10 chars, A-Z / 0-9 / "-" only.
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "Venue code must be 2 to 10 characters")
      .max(10, "Venue code must be 2 to 10 characters")
      .regex(
        /^[A-Z0-9-]+$/,
        "Venue code may only contain uppercase letters A-Z, digits 0-9 and hyphens (-)",
      ),
    type: VenueTypeSchema,
    // Whole number from 1 to 1000; decimals, 0, negatives and numeric strings are rejected.
    capacity: z
      .number()
      .int("Capacity must be a whole number")
      .min(1, "Capacity must be at least 1")
      .max(1000, "Capacity must be at most 1000"),
    // Subset of ALLOWED_FACILITIES, no duplicates, at most 4 entries.
    facilities: z
      .array(z.enum(ALLOWED_FACILITIES))
      .max(4, "A venue may have at most 4 facilities")
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate facilities are not allowed",
      )
      .default([]),
    status: VenueStatusSchema.default("ACTIVE"),
    // Trimmed 1-100 characters, or null meaning a shared venue.
    ownerDepartmentId: z
      .string()
      .trim()
      .min(1, "An owning department is required")
      .max(100, "Owning department id must be at most 100 characters")
      .nullish()
      .default(null),
  });

export type VenueInput = z.infer<typeof VenueInputSchema>;

/**
 * "SHARED" when the venue has no owning department (null), otherwise "OWNED".
 */
export function venueOwnership(owner: string | null): "SHARED" | "OWNED" {
  return owner === null ? "SHARED" : "OWNED";
}
