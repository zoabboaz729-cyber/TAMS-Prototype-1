/**
 * Server-side add operation for one new DRAFT timetable entry (M3-T2b3a).
 *
 * An authorised officer may append a single teaching session to an existing
 * DRAFT version. The request carries only `versionId`, `teachingId`,
 * `venueId`, `day`, `start` and `end` — the new entry's `locked` flag is
 * always false and is never taken from the request, and there is nothing to
 * overwrite: existing entries of the draft are preserved untouched.
 *
 * Conflicts are NOT blocked here, consistent with the accepted move
 * operation (M3-T2b1). An added entry that clashes with another stays in the
 * DRAFT; the M3 validator (re-run by the caller via `loadDraftForValidation`)
 * reports the violation. The add result therefore never claims a conflict-free
 * state — it only reports whether the entry was created.
 *
 * Security rules enforced here, not in the UI:
 * - EDIT_DRAFT is decided BEFORE any store call, so an unauthorised caller
 *   (student, lecturer, department rep, approver, admin, or no session)
 *   triggers zero reads of timetable data and learns nothing.
 * - Untrusted input is validated with the existing Zod schemas (Day, TimeHHMM,
 *   isStartBeforeEnd) before any record is read.
 * - The target version must exist and be DRAFT; PUBLISHED and ARCHIVED are
 *   refused (requirement: no creation outside DRAFT).
 * - The teaching and the venue must exist before the entry is created.
 * - The write is one transaction: the version's DRAFT status is re-checked
 *   inside it, so a concurrent publish or version removal fails as STALE and
 *   inserts nothing — the same convention as the move's compare-and-set.
 *   There is no expected-previous-schedule token because a new row has no
 *   previous state; the version status is the only precondition.
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
import type { DraftVersionRow } from "@/server/draftValidation";

// ---------------------------------------------------------------------------
// Store interface (injected; Prisma adapter in draftStorePrisma.ts)
// ---------------------------------------------------------------------------

/** Everything the new entry is built from: the requested references and the
 *  validated schedule. `locked` is not a field — the store sets it to false. */
export type AddFields = {
  versionId: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
};

/** Audit row written in the same transaction as the entry insert. */
export type AddAuditDraft = {
  actorId: string;
  action: "TIMETABLE_ENTRY_ADD";
  reason: string;
};

/**
 * Write + lookup interface for the add. Reuses {@link DraftVersionRow} from
 * the read loader so the row shape never drifts.
 *
 * `createEntry` runs inside one transaction: it must re-verify the version
 * still exists and is still DRAFT, then insert the entry and the audit row
 * together, returning `{ stale: true }` when the version changed (published
 * or removed) since the pre-checks. A store implementation must never persist
 * anything when `stale`, and must give the created entry a fresh id.
 */
export interface DraftAddStore {
  findVersion(versionId: string): Promise<DraftVersionRow | null>;
  findTeachingById(teachingId: string): Promise<{ id: string } | null>;
  findVenueById(venueId: string): Promise<{ id: string } | null>;
  createEntry(
    fields: AddFields,
    audit: AddAuditDraft,
  ): Promise<{ ok: true; entryId: string } | { stale: true }>;
}

// ---------------------------------------------------------------------------
// Request + result
// ---------------------------------------------------------------------------

export type DraftAddRequest = {
  versionId: string;
  teachingId: string;
  venueId: string;
  day: string;
  start: string;
  end: string;
};

/**
 * Typed outcome. `ok: true` reports only that the entry was created, with its
 * newly generated id; it does not mean the timetable is conflict-free — the
 * caller must re-run `loadDraftForValidation()` to show violations. Failure
 * kinds:
 * - UNAUTHENTICATED / FORBIDDEN — access denied, no data read.
 * - INVALID_INPUT — malformed day/time or start not before end.
 * - VERSION_NOT_FOUND / TEACHING_NOT_FOUND / VENUE_NOT_FOUND — missing record.
 * - NOT_DRAFT — version exists but is PUBLISHED or ARCHIVED.
 * - STALE — the version was published or removed between the pre-checks and
 *   the transactional re-check, so nothing was inserted.
 * - INTERNAL_ERROR — store failure.
 */
export type DraftAddResult =
  | { ok: true; entryId: string; versionId: string }
  | {
      ok: false;
      kind:
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "VERSION_NOT_FOUND"
        | "TEACHING_NOT_FOUND"
        | "VENUE_NOT_FOUND"
        | "STALE"
        | "INTERNAL_ERROR";
    }
  | { ok: false; kind: "INVALID_INPUT"; message: string }
  | { ok: false; kind: "NOT_DRAFT"; versionId: string; storedStatus: TimetableVersionStatus };

// ---------------------------------------------------------------------------
// Input validation (reuses existing domain schemas)
// ---------------------------------------------------------------------------

const DraftAddInputSchema = z
  .object({
    versionId: z.string().trim().min(1, "Version id is required"),
    teachingId: z.string().trim().min(1, "Teaching id is required"),
    venueId: z.string().trim().min(1, "Venue id is required"),
    day: DaySchema,
    start: TimeHHMMSchema,
    end: TimeHHMMSchema,
  })
  .refine((data) => isStartBeforeEnd(data.start, data.end), {
    message: "Start time must be before end time",
    path: ["end"],
  });

/** Turn a Zod error into one plain-language message (what went wrong + what to do). */
function addInputMessage(error: z.ZodError): string {
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
// Add orchestration
// ---------------------------------------------------------------------------

/**
 * Add one entry to a DRAFT version.
 *
 * Order: null check → EDIT_DRAFT → Zod input → version (exists, DRAFT) →
 * teaching (exists) → venue (exists) → transactional insert. Every step
 * before the write is a guard; the write is the only mutation and never
 * touches rows that already exist.
 */
export async function performDraftAdd(
  store: DraftAddStore,
  actor: Actor | null,
  request: DraftAddRequest,
): Promise<DraftAddResult> {
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
  const parsed = DraftAddInputSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: addInputMessage(parsed.error) };
  }
  const input = parsed.data;

  try {
    // 4. Version exists and is DRAFT. PUBLISHED/ARCHIVED are refused before
    //    any further read, so nothing is ever created outside a draft.
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

    // 5. The teaching assignment exists. The request's teachingId is the only
    //    source of the entry's teaching — it is never copied from another row.
    const teaching = await store.findTeachingById(input.teachingId);
    if (teaching === null) {
      return { ok: false, kind: "TEACHING_NOT_FOUND" };
    }

    // 6. The venue exists.
    const venue = await store.findVenueById(input.venueId);
    if (venue === null) {
      return { ok: false, kind: "VENUE_NOT_FOUND" };
    }

    // 7. Insert the new row only. No existing entry is read or written here;
    //    the store re-checks the version is still DRAFT inside the same
    //    transaction as the entry + audit insert.
    const fields: AddFields = {
      versionId: input.versionId,
      teachingId: input.teachingId,
      venueId: input.venueId,
      day: input.day,
      start: input.start,
      end: input.end,
    };
    const audit: AddAuditDraft = {
      actorId: actor.id,
      action: "TIMETABLE_ENTRY_ADD",
      reason: `Added entry to version ${input.versionId}: ${input.day} ${input.start}-${input.end} @ ${input.venueId}.`,
    };

    const result = await store.createEntry(fields, audit);
    if ("stale" in result) {
      // The version was published or removed between step 4 and the
      // transaction — the same STALE convention as the move's compare-and-set.
      return { ok: false, kind: "STALE" };
    }
    return { ok: true, entryId: result.entryId, versionId: input.versionId };
  } catch (error) {
    console.error(
      "[draftAdd] add failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
