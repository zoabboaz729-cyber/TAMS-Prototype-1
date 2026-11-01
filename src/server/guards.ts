/**
 * Server-only authorization guards for TAMS.
 *
 * Call these on every page, route handler, and server action that needs
 * authentication or authorization. Layouts are NOT a security boundary:
 * they do not re-run on client navigation, so each route must guard itself.
 *
 * `redirect()` works by throwing, so it is never called inside a try/catch.
 *
 * Must only be imported in Server Components, Route Handlers, and Server Actions
 * (it calls getCurrentUser(), which reads cookies and the database).
 */
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, type SafeUser } from "@/server/auth";
import { decideAccess, decideAnyAccess, type AccessDecision } from "@/domain/access";
import type { Action, Resource } from "@/domain/permissions";

/**
 * Require an authenticated user.
 * No session -> redirect to /login (redirect throws; this does not return).
 */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  return user;
}

/**
 * Require an authenticated user who is allowed to perform `action` on
 * `resource`.
 * - No session      -> redirect("/login").
 * - decideAccess FORBIDDEN -> redirect("/forbidden").
 * - ALLOW           -> return the user.
 */
export async function requireAction(
  action: Action,
  resource?: Resource,
): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  const decision: AccessDecision = decideAccess(user, action, resource);
  if (decision.status !== "ALLOW") {
    redirect("/forbidden");
  }
  return user;
}

/**
 * Require an authenticated user who may perform `action` on SOME resource
 * (page-entry decision). No per-record check is made here.
 * - No session              -> redirect("/login").
 * - decideAnyAccess not ALLOW -> redirect("/forbidden").
 * - ALLOW                   -> return the user.
 *
 * Use for page entry only: OWN_DEPARTMENT-scoped actions (e.g. DECLARE_VENUE
 * for a department rep) need a resource to be rechecked, and that recheck
 * happens in the server action that changes data. redirect() throws, so it
 * stays outside any try/catch.
 */
export async function requireAnyAction(
  action: Action,
): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  const decision: AccessDecision = decideAnyAccess(user, action);
  if (decision.status !== "ALLOW") {
    redirect("/forbidden");
  }
  return user;
}

/**
 * API variant of requireAction: returns JSON errors instead of redirecting.
 * - No session      -> 401 { "error": "unauthenticated" }.
 * - decideAccess FORBIDDEN -> 403 { "error": "forbidden" }.
 * - ALLOW           -> { ok: true, user }.
 * The response body never contains the role, action, or any other detail.
 */
export async function authorizeApi(
  action: Action,
  resource?: Resource,
): Promise<
  | { ok: true; user: SafeUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (user === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const decision: AccessDecision = decideAccess(user, action, resource);
  if (decision.status !== "ALLOW") {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
