/**
 * Server-side move operation for one existing DRAFT timetable entry (M3-T2b1).
 *
 * An authorised officer may change the day, start, end and venue of a single
 * entry that already lives in a DRAFT version. The teaching assignment, the
 * version the entry belongs to and the lock flag are never taken from the
 * request — only `day`, `start`, `end` and `venueId` may be written.
 *
 * Conflicts are NOT blocked here. A move that lands an entry into a clash
 * remains in the DRAFT; the M3 validator (re-run by the caller via the M3-T2a
 * loader) reports the violation. The move result therefore never claims a
 * conflict-free state — it only reports whether the operation succeeded.
 *
 * Security rules enforced here, not in the UI:
 * - EDIT_DRAFT is decided BEFORE any store call, so an unauthorised caller
 *   (student, lecturer, department rep, approver, admin, or no session)
 *   triggers zero reads of timetable data and learns nothing.
 * - Untrusted input is validated with the existing Zod schemas (Day, TimeHHMM,
 *   isStartBeforeEnd) before any record is read.
 * - Only permitted fields are persisted; teachingId, versionId and locked are
 *   never written. The compare-and-set in the store re-verifies the version is
 *   still DRAFT and the entry still unlocked inside the transaction, so a
 *   version published or entry locked mid-operation fails as STALE.
 *
 * The store is injected so the orchestration is unit-tested without a
 * database; the Prisma adapter lives in src/server/draftStorePrisma.ts.
 */
import { z } from "zod";
import { decideAccess } from "@/domain/access";
import type { Actor } from "@/domain/permissions";
import {
  DaySchema,
  TimeHHMMSchema,
  isStartBeforeEnd,
  type TimetableVersionStatus,
} from "@/domain/types";
import type { DraftEntryRow, DraftVersionRow } from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Row types reused from the M3-T2a read loader (no duplication)
// ---------------------------------------------------------------------------

export type { DraftEntryRow, DraftVersionRow } from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Store interface (injected; Prisma adapter in draftStorePrisma.ts)
// ---------------------------------------------------------------------------

/** Only the fields a move is allowed to change. */
export type MoveFields = {
  day: string;
  start: string;
  end: string;
  venueId: string;
};

/** Audit row written in the same transaction as the entry update. */
export type MoveAuditDraft = {
  actorId: string;
  action: "TIMETABLE_ENTRY_MOVE";
  reason: string;
};

/**
 * Write + lookup interface for the move. Reuses {@link DraftVersionRow} and
 * {@link DraftEntryRow} from the read loader so the row shapes never drift.
 *
 * `moveEntry` applies a compare-and-set: it must re-verify the version is still
 * DRAFT and the entry still unlocked inside the write transaction, returning
 * `{ stale: true }` when either precondition changed. A store implementation
 * must never persist when `stale`.
 */
export interface DraftMoveStore {
  findVersion(versionId: string): Promise<DraftVersionRow | null>;
  findEntry(entryId: string): Promise<DraftEntryRow | null>;
  findVenueById(venueId: string): Promise<{ id: string } | null>;
  moveEntry(
    entryId: string,
    expectedVersionId: string,
    fields: MoveFields,
    audit: MoveAuditDraft,
  ): Promise<{ ok: true } | { stale: true }>;
}

// ---------------------------------------------------------------------------
// Request + result
// ---------------------------------------------------------------------------

export type DraftMoveRequest = {
  versionId: string;
  entryId: string;
  day: string;
  start: string;
  end: string;
  venueId: string;
};

/**
 * Typed outcome. `ok: true` reports only that the entry was moved; it does not
 * mean the timetable is conflict-free. Failure kinds:
 * - UNAUTHENTICATED / FORBIDDEN — access denied, no data read.
 * - INVALID_INPUT — malformed day/time or start not before end.
 * - VERSION_NOT_FOUND / ENTRY_NOT_FOUND / VENUE_NOT_FOUND — missing record.
 * - NOT_DRAFT — version exists but is PUBLISHED or ARCHIVED.
 * - ENTRY_WRONG_VERSION — entry exists but belongs to another version.
 * - ENTRY_LOCKED — entry is locked and must not move.
 * - STALE — version published or entry locked during the operation.
 * - INTERNAL_ERROR — store failure.
 */
export type DraftMoveResult =
  | { ok: true; entryId: string; versionId: string }
  | {
      ok: false;
      kind:
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "VERSION_NOT_FOUND"
        | "ENTRY_NOT_FOUND"
        | "ENTRY_WRONG_VERSION"
        | "ENTRY_LOCKED"
        | "VENUE_NOT_FOUND"
        | "STALE"
        | "INTERNAL_ERROR";
    }
  | { ok: false; kind: "INVALID_INPUT"; message: string }
  | { ok: false; kind: "NOT_DRAFT"; versionId: string; storedStatus: TimetableVersionStatus };

// ---------------------------------------------------------------------------
// Input validation (reuses existing domain schemas)
// ---------------------------------------------------------------------------

const DraftMoveInputSchema = z
  .object({
    versionId: z.string().trim().min(1, "Version id is required"),
    entryId: z.string().trim().min(1, "Entry id is required"),
    day: DaySchema,
    start: TimeHHMMSchema,
    end: TimeHHMMSchema,
    venueId: z.string().trim().min(1, "Venue id is required"),
  })
  .refine((data) => isStartBeforeEnd(data.start, data.end), {
    message: "Start time must be before end time",
    path: ["end"],
  });

/** Turn a Zod error into one plain-language message (what went wrong + what to do). */
function moveInputMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "Invalid input.";
  const field = issue.path[0];

  // The refine check on start-before-end uses code "custom" on path ["end"].
  if (field === "end" && issue.code === z.ZodIssueCode.custom) {
    return "Start time must be before end time.";
  }
  if (field === "start" || field === "end") {
    return "Time must be in HH:MM format (00:00-23:59).";
  }
  if (field === "day") {
    return "Day must be one of MON, TUE, WED, THU, FRI.";
  }
  // Missing/empty id fields carry their own message from the schema.
  return issue.message;
}

// ---------------------------------------------------------------------------
// Move orchestration
// ---------------------------------------------------------------------------

/**
 * Move one DRAFT entry's day, start, end and venue.
 *
 * Order: null check → EDIT_DRAFT → Zod input → version (DRAFT) → entry
 * (belongs to version, unlocked) → venue (exists) → compare-and-set write.
 * Every step before the write is a guard; the write is the only mutation.
 */
export async function performDraftMove(
  store: DraftMoveStore,
  actor: Actor | null,
  request: DraftMoveRequest,
): Promise<DraftMoveResult> {
  // 1. No session → deny before any read (narrows actor to non-null below).
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  // 2. EDIT_DRAFT before any restricted read. ALL-scoped for officer, NONE
  //    for every other role, so a denied caller triggers zero store calls.
  const access = decideAccess(actor, "EDIT_DRAFT");
  if (access.status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  // 3. Validate untrusted input. Still no store call, so a malformed request
  //    from an authorised officer reads nothing.
  const parsed = DraftMoveInputSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: moveInputMessage(parsed.error) };
  }
  const input = parsed.data;

  try {
    // 4. Version exists and is DRAFT.
    const version = await store.findVersion(input.versionId);
    if (version === null) {
      return { ok: false, kind: "VERSION_NOT_FOUND" };
    }
    if (version.status !== "DRAFT") {
      return {
        ok: false,
        kind: "NOT_DRAFT",
        versionId: version.id,
        storedStatus: version.status,
      };
    }

    // 5. Entry exists, belongs to this version, and is not locked.
    const entry = await store.findEntry(input.entryId);
    if (entry === null) {
      return { ok: false, kind: "ENTRY_NOT_FOUND" };
    }
    if (entry.versionId !== input.versionId) {
      return { ok: false, kind: "ENTRY_WRONG_VERSION" };
    }
    if (entry.locked) {
      return { ok: false, kind: "ENTRY_LOCKED" };
    }

    // 6. Proposed venue exists.
    const venue = await store.findVenueById(input.venueId);
    if (venue === null) {
      return { ok: false, kind: "VENUE_NOT_FOUND" };
    }

    // 7. Persist only the permitted fields. teachingId, versionId and locked
    //    are never written. The store re-checks the version is still DRAFT and
    //    the entry still unlocked inside the transaction (compare-and-set).
    const fields: MoveFields = {
      day: input.day,
      start: input.start,
      end: input.end,
      venueId: input.venueId,
    };
    const audit: MoveAuditDraft = {
      actorId: actor.id,
      action: "TIMETABLE_ENTRY_MOVE",
      reason: `Moved from ${entry.day} ${entry.start}-${entry.end} @ ${entry.venueId} to ${input.day} ${input.start}-${input.end} @ ${input.venueId}.`,
    };

    const result = await store.moveEntry(input.entryId, input.versionId, fields, audit);
    if ("stale" in result) {
      return { ok: false, kind: "STALE" };
    }
    return { ok: true, entryId: input.entryId, versionId: input.versionId };
  } catch (error) {
    console.error(
      "[draftMove] move failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
