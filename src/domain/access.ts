/**
 * Access decision layer for Kisii University TAMS (PROTOTYPE_SPEC §8).
 *
 * Pure domain logic: turns an actor, an action, and an optional resource
 * into an AccessDecision by delegating to canAct() from permissions.ts.
 * No database, network, Next.js, or clock dependencies. Never throws.
 */
import type { Action, Actor, Resource } from "./permissions";
import { canAct, permissionScope } from "./permissions";

/**
 * The result of an access check.
 *  - UNAUTHENTICATED: no actor (no session) — authenticate first.
 *  - FORBIDDEN: authenticated but not permitted for this action/resource.
 *  - ALLOW: the action is permitted.
 */
export type AccessDecision =
  | { status: "ALLOW" }
  | { status: "UNAUTHENTICATED" }
  | { status: "FORBIDDEN" };

/**
 * Decide whether `actor` may perform `action` on `resource`.
 *
 * Deny by default, never throws:
 *  - actor === null           -> UNAUTHENTICATED
 *  - canAct(...) === true     -> ALLOW
 *  - otherwise                -> FORBIDDEN
 *
 * canAct() never throws, so decideAccess() never throws either.
 */
export function decideAccess(
  actor: Actor | null,
  action: Action,
  resource?: Resource,
): AccessDecision {
  if (actor === null) {
    return { status: "UNAUTHENTICATED" };
  }
  return canAct(actor, action, resource)
    ? { status: "ALLOW" }
    : { status: "FORBIDDEN" };
}

/**
 * Page-entry decision: may `actor` ever perform `action` on SOME resource.
 *
 * Unlike decideAccess, no resource is required: a scope such as
 * OWN_DEPARTMENT counts as ALLOW here because the resource is chosen after
 * page entry. The per-record decision must still be made with decideAccess
 * or the specific rule function in the action that changes data.
 *
 * Rules:
 *  - actor === null              -> UNAUTHENTICATED
 *  - permissionScope(...) !== "NONE" -> ALLOW
 *  - otherwise                   -> FORBIDDEN
 * Never throws; an unknown runtime role gives FORBIDDEN.
 */
export function decideAnyAccess(
  actor: Actor | null,
  action: Action,
): AccessDecision {
  if (actor === null) {
    return { status: "UNAUTHENTICATED" };
  }
  return permissionScope(actor.role, action) !== "NONE"
    ? { status: "ALLOW" }
    : { status: "FORBIDDEN" };
}
