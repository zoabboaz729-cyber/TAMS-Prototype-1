/** M5 read-only contract. No raw timetable or actor-controlled publication selector. */
import { z } from "zod";
import { VenueClockSchema, type VenueClock, type VenueStatusResult } from "@/domain/venueStatus";
const semester = z.enum(["1", "2"]).default("1");
export const VenueStatusRequestSchema = z.union([
  z.object({ semester, mode: z.literal("live").optional() }).strict(),
  z.object({ semester, mode: z.literal("demo"), day: z.string(), time: z.string() }).strict(),
]);
export type VenueStatusRequest = z.infer<typeof VenueStatusRequestSchema>;
export type VenueStatusFailureKind = "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "INVALID_CLOCK" |
  "NO_PUBLISHED_VERSION" | "AMBIGUOUS_PUBLISHED_VERSION" | "INVALID_PUBLISHED_DATA" | "INTERNAL_ERROR";
export type VenueStatusFailure = { ok: false; kind: VenueStatusFailureKind; message: string };
/** Unknown return is intentional: the service validates persisted data before deriving availability. */
export interface VenueStatusStore { readSnapshot(semester: number): Promise<unknown> }
export const VenueStatusSnapshotSchema = z.object({
  versions: z.array(z.object({ id: z.string().min(1), semester: z.number().int(), status: z.string(), publishedAt: z.date().nullable() })),
  venues: z.array(z.unknown()),
  entries: z.array(z.object({
    versionId: z.string().min(1), venueId: z.string().min(1), day: z.string(), start: z.string(), end: z.string(),
    unitSemester: z.number().int(),
  })),
});
export type VenueStatusRow = {
  code: string; type: string; status: Extract<VenueStatusResult, { ok: true }>["status"];
  nextFreeAt: VenueClock | null; nextScheduledAt: VenueClock | null;
  nextFreeOutsideHours: boolean; unavailableKind: "operational" | "closure" | null;
};
export type VenueStatusBoard = {
  ok: true; semester: number; publication: { id: string; publishedAt: string };
  mode: "live" | "demo"; asOf: z.infer<typeof VenueClockSchema>; outsideHours: boolean;
  rows: VenueStatusRow[]; integrityCount?: number;
};
export type VenueStatusBoardResult = VenueStatusBoard | VenueStatusFailure;
export const VENUE_STATUS_MESSAGES: Record<VenueStatusFailureKind, string> = {
  UNAUTHENTICATED: "Sign in to view venue status.",
  FORBIDDEN: "This venue clock is not permitted for your account. Return to live status or contact an officer.",
  INVALID_INPUT: "Invalid venue status request. Choose semester 1 or 2 and use only the labelled clock controls.",
  INVALID_CLOCK: "Invalid clock. Choose a weekday and a valid 24-hour HH:MM time.",
  NO_PUBLISHED_VERSION: "No published timetable exists for this semester. The board cannot infer availability. Ask an officer to publish a valid timetable.",
  AMBIGUOUS_PUBLISHED_VERSION: "Multiple current publications were found. Availability cannot be inferred; ask an officer to resolve them.",
  INVALID_PUBLISHED_DATA: "Published timetable or venue data is inconsistent. Availability cannot be inferred; ask an officer to review it.",
  INTERNAL_ERROR: "Venue status could not be loaded. Try again or contact an officer.",
};
