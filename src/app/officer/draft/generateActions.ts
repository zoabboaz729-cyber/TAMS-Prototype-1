"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { decideAccess } from "@/domain/access";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import { performDraftGenerate } from "@/server/draftGenerate";
import { createDraftGenerateStore } from "@/server/draftGenerateStorePrisma";
import {
  GenerateDraftInputSchema,
  generateInputMessage,
  type DraftGenerateResult,
} from "@/server/draftGenerateContract";

/**
 * Boundary schema for the generate-draft action (M4-T2c1).
 *
 * It is the accepted M4-T2a contract schema with `.strict()` applied, so the
 * semester and source-id rules live in exactly one place (`GenerateDraftInput
 * Schema`) and are not restated here. Strictness is the boundary's own job:
 * the service strips unknown keys (a server-side caller may legitimately pass
 * a wider object), but a browser payload carrying `actorId`, `createdBy`,
 * `role`, `status`, `locked`, `softScore` or any other authorization or
 * persistence field is refused outright instead of being quietly ignored.
 *
 * The semester stays a number here. Converting `"1"` to `1` would make this
 * boundary a second place where the request is interpreted; the officer UI
 * sends the number the picker actually holds.
 */
const GenerateDraftActionInputSchema = GenerateDraftInputSchema.strict();

/**
 * `generateInputMessage` already phrases the service's own rule violations.
 * An unrecognized key is different: it is always an attempted forgery, so it
 * gets a fixed message rather than Zod's internal key-list wording.
 */
function boundaryMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue !== undefined && issue.code === "unrecognized_keys") {
    return (
      "The generate request cannot carry extra fields such as an actor, a role or a lock. " +
      "Reload the page and try again."
    );
  }
  return generateInputMessage(error);
}

function invalidRequest(error: z.ZodError): DraftGenerateResult {
  return { ok: false, kind: "INVALID_INPUT", message: boundaryMessage(error) };
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
 * Generate a new DRAFT timetable version for one semester (M4-T2c1).
 *
 * Order of enforcement, mirroring `moveDraftEntryAction` and
 * `addDraftEntryAction` in src/app/officer/draft/actions.ts:
 * 1. same-origin check — a cross-site call is FORBIDDEN before the session is
 *    even read;
 * 2. session — no session is UNAUTHENTICATED;
 * 3. `GENERATE_TIMETABLE` via the accepted `decideAccess` — a role the matrix
 *    does not grant is FORBIDDEN. Steps 1–3 all run before
 *    `createDraftGenerateStore()` exists, so a refused caller triggers zero
 *    database reads and zero writes;
 * 4. input shape — forged, unknown, missing or wrongly typed fields are
 *    rejected, still before any store is created;
 * 5. `performDraftGenerate(createDraftGenerateStore(), user, request)` — the
 *    accepted service re-decides authorization, validates semantics, loads the
 *    scoped reads, runs the generator and the M3 validator, and commits one
 *    atomic write. Its typed `DraftGenerateResult` is returned unchanged.
 *
 * The authenticated actor is the session user, never a request field: the
 * request type has no actor slot at all and the strict schema refuses anyone
 * who adds one.
 *
 * `{ ok: true, versionId, entryCount, softScore }` is only produced by the
 * service after its transaction committed. `PARTIAL_GENERATION` carries a
 * placement count and is still `ok: false` — a number of placed sessions is
 * never presented as a saved version, because nothing was written.
 */
export async function generateDraftAction(input: unknown): Promise<DraftGenerateResult> {
  if (!(await requestIsSameOrigin())) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  if (decideAccess(user, "GENERATE_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const parsed = GenerateDraftActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error);
  }

  try {
    return await performDraftGenerate(createDraftGenerateStore(), user, parsed.data);
  } catch (error) {
    // Unexpected failure — including a store factory that cannot connect. Log
    // the message only (never the error object, query, connection string or
    // payload) and return the same typed code the service uses, so no internal
    // database detail reaches the browser.
    console.error(
      "[officer/draft] generate action failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
