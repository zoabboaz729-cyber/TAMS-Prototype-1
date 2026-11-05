"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import {
  createDraftAddStore,
  createDraftMoveStore,
} from "@/server/draftStorePrisma";
import { performDraftAdd, type DraftAddResult } from "@/server/draftAdd";
import { performDraftMove, type DraftMoveResult } from "@/server/draftMove";

/**
 * Boundary schema for the draft-move action (M3-T2c1).
 *
 * This checks SHAPE only — every field must be a string and nothing else may
 * be sent. Semantic validation (day set, HH:MM format, start-before-end,
 * non-empty trimmed ids) stays in `performDraftMove`, so the rules are not
 * duplicated here.
 *
 * `.strict()` rejects unknown keys instead of silently ignoring them: a
 * browser payload carrying `role`, `userId`, `actorId`, `locked`, `versionId`
 * overrides or any other forged authorization field is refused outright.
 * Identity always comes from the session and the writable field set is fixed
 * by the service, never by the caller.
 */
const DraftMoveActionInputSchema = z
  .object({
    versionId: z.string(),
    entryId: z.string(),
    day: z.string(),
    start: z.string(),
    end: z.string(),
    venueId: z.string(),
    expectedDay: z.string(),
    expectedStart: z.string(),
    expectedEnd: z.string(),
    expectedVenueId: z.string(),
  })
  .strict();

function invalidRequest(): DraftMoveResult {
  return {
    ok: false,
    kind: "INVALID_INPUT",
    message: "The move request is not a valid draft move. Reload the draft and try again.",
  };
}

async function requestIsSameOrigin(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameOriginRequest({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    secFetchSite: requestHeaders.get("sec-fetch-site"),
  });
}

/**
 * Move one entry in a DRAFT timetable version (M3-T2c1).
 *
 * Order of enforcement, mirroring src/app/submissions/actions.ts:
 * 1. same-origin check — a cross-site call is FORBIDDEN before the session
 *    is even read;
 * 2. session — no session is UNAUTHENTICATED, and no store is created;
 * 3. input shape — forged/unknown fields are rejected before any store exists;
 * 4. `performDraftMove` — EDIT_DRAFT role check, semantic validation,
 *    existence checks and the optimistic-concurrency compare-and-set. The
 *    typed result (ok / STALE / ENTRY_LOCKED / NOT_DRAFT / FORBIDDEN /
 *    INVALID_INPUT / ...) is returned unchanged.
 *
 * A successful result is `{ ok: true, entryId, versionId }` only — it never
 * claims the draft is conflict-free. The editor must reload the draft through
 * `loadDraftForValidation()` and re-run the validator before showing the
 * officer any "no conflicts" statement.
 */
export async function moveDraftEntryAction(input: unknown): Promise<DraftMoveResult> {
  if (!(await requestIsSameOrigin())) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  const parsed = DraftMoveActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest();
  }

  try {
    return await performDraftMove(createDraftMoveStore(), user, parsed.data);
  } catch (error) {
    // Unexpected failure: log the message only (never the error object,
    // query, or connection details) and return the same typed code the
    // service uses, so no internal database information reaches the browser.
    console.error(
      "[officer/draft] move action failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

/**
 * Boundary schema for the draft-add action (M3-T2b3b).
 *
 * Shape only, exactly like the move boundary: every one of the six fields
 * must be a string and nothing else may be sent. Semantic validation (day
 * set, HH:MM format, start-before-end, non-empty trimmed ids) stays in
 * `performDraftAdd`, so the rules are not duplicated here.
 *
 * `.strict()` rejects unknown keys instead of silently ignoring them: a
 * browser payload carrying `id`, `locked`, `actorId`, `userId`, `role`,
 * `status`, `createdBy` or any other forged field is refused outright. The
 * created row's id and `locked: false` flag are assigned by the store, and
 * the audit actor comes from the session — never from this payload.
 */
const DraftAddActionInputSchema = z
  .object({
    versionId: z.string(),
    teachingId: z.string(),
    venueId: z.string(),
    day: z.string(),
    start: z.string(),
    end: z.string(),
  })
  .strict();

function invalidAddRequest(): DraftAddResult {
  return {
    ok: false,
    kind: "INVALID_INPUT",
    message:
      "The add request is not a valid draft entry. Reload the draft and try again.",
  };
}

/**
 * Add one entry to a DRAFT timetable version (M3-T2b3b).
 *
 * Order of enforcement, mirroring `moveDraftEntryAction` above:
 * 1. same-origin check — a cross-site call is FORBIDDEN before the session
 *    is even read;
 * 2. session — no session is UNAUTHENTICATED, and no store is created;
 * 3. input shape — forged/unknown/non-string fields are rejected before any
 *    store exists;
 * 4. `performDraftAdd` — EDIT_DRAFT role check, semantic validation,
 *    version/teaching/venue existence checks and the transactional DRAFT
 *    re-check. The typed result (ok / STALE / NOT_DRAFT / FORBIDDEN /
 *    UNAUTHENTICATED / INVALID_INPUT / VERSION_NOT_FOUND /
 *    TEACHING_NOT_FOUND / VENUE_NOT_FOUND / INTERNAL_ERROR) is returned
 *    unchanged.
 *
 * A successful result is `{ ok: true, entryId, versionId }` only — it never
 * claims the draft is conflict-free. The editor must reload the draft
 * through `loadDraftForValidation()` and re-run the validator before
 * showing the officer any "no conflicts" statement.
 */
export async function addDraftEntryAction(input: unknown): Promise<DraftAddResult> {
  if (!(await requestIsSameOrigin())) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  const parsed = DraftAddActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidAddRequest();
  }

  try {
    return await performDraftAdd(createDraftAddStore(), user, parsed.data);
  } catch (error) {
    // Unexpected failure: log the message only (never the error object,
    // query, or connection details) and return the same typed code the
    // service uses, so no internal database information reaches the browser.
    console.error(
      "[officer/draft] add action failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
