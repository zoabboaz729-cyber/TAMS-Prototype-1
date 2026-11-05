"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import { createDraftMoveStore } from "@/server/draftStorePrisma";
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
