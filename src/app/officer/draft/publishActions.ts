"use server";

import { headers } from "next/headers";
import { decideAccess } from "@/domain/access";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import { performDraftPublish } from "@/server/draftPublish";
import { createDraftPublishStore } from "@/server/draftPublishStorePrisma";
import {
  PublishDraftInputSchema,
  publishInputMessage,
  type DraftPublishResult,
} from "@/server/draftPublishContract";

/** Mirrors `generateActions.ts` and the move/add actions in `actions.ts`. */
async function requestIsSameOrigin(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameOriginRequest({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    secFetchSite: requestHeaders.get("sec-fetch-site"),
  });
}

/**
 * Publish one validated DRAFT timetable version (M4-T3c1).
 *
 * This module is the browser's only door to the accepted M4-T3a service and the
 * accepted M4-T3b atomic adapter. It connects them; it decides nothing of its
 * own beyond the four refusals below. Order of enforcement:
 *
 * 1. same-origin — `headers()` + the accepted `isSameOriginRequest`. A
 *    cross-site call is FORBIDDEN before the session cookie is even read;
 * 2. session — `getCurrentUser()`. No session is UNAUTHENTICATED;
 * 3. `PUBLISH_TIMETABLE` through the accepted `decideAccess` permission model —
 *    spec §8 grants publication to the timetabling officer only, so a student,
 *    lecturer, department rep, approver or admin caller is FORBIDDEN;
 * 4. request shape — `PublishDraftInputSchema` (see below). A malformed or
 *    forged payload is INVALID_INPUT;
 * 5. `createDraftPublishStore()` — the Prisma adapter is constructed only now,
 *    so every refusal above provably creates no store and runs no query;
 * 6. `performDraftPublish(store, user, request)` — the accepted service
 *    re-decides authorization from the session actor, re-validates the request,
 *    runs the mandatory final M3 validation, recomputes the snapshot
 *    fingerprint and commits the archive + publish + audit in one transaction.
 *    Its typed `DraftPublishResult` is returned unchanged;
 * 7. the typed result is passed through to the caller.
 *
 * Identity and lifecycle come from the server, never the request. The session
 * user is the only actor the service is told about, and the request schema is
 * already `.strict()` in the accepted contract — so unlike the generate
 * boundary, no `.strict()` is re-applied here and no rule is restated:
 * `versionId` is the one field a browser may send, and `actorId`, `createdBy`,
 * `role`, `status`, `publishedAt`, `semester`, `archivedVersionIds` or
 * `snapshotFingerprint` in the payload is refused as INVALID_INPUT before a
 * store exists. `publishInputMessage` already phrases every case in
 * plain language, including the forged-key case.
 *
 * Nothing here can turn a refusal into a success: `HARD_VIOLATIONS`,
 * `INCOMPLETE_VALIDATION`, `EMPTY_DRAFT`, `NOT_DRAFT`, `VERSION_NOT_FOUND`,
 * `INVALID_VERSION_DATA` and `STALE` are returned exactly as the service made
 * them, all still `ok: false`, because nothing was committed. `ok: true` with
 * its `versionId`, `semester`, `archivedVersionIds` and `publishedAt` is only
 * ever produced by the service after its transaction committed, and the
 * timestamp is the service's injected server clock — this action passes no
 * `now`, so no request can set a publication time.
 *
 * An unexpected throw at this boundary (a store factory that cannot connect)
 * returns INTERNAL_ERROR and logs one fixed operational line. Per M4-T3b1, no
 * detail derived from the exception may be logged: a Prisma or SQLite message
 * can carry SQL, a connection string with credentials, or the snapshot
 * fingerprint. The service's own `catch` already logs its fixed line for
 * failures inside the publication; this message names the action boundary so an
 * operator can tell the two apart, and it carries no payload either.
 */
export async function publishDraftAction(input: unknown): Promise<DraftPublishResult> {
  if (!(await requestIsSameOrigin())) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  if (decideAccess(user, "PUBLISH_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  const parsed = PublishDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: publishInputMessage(parsed.error) };
  }

  try {
    return await performDraftPublish(createDraftPublishStore(), user, parsed.data);
  } catch {
    console.error("[officer/draft] publish action failed; returning INTERNAL_ERROR");
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
