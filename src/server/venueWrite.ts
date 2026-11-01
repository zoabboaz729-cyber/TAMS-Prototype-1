import type { VenueFormErrors as FormErrors } from "../domain/venueForm";
import { parseVenueForm } from "../domain/venueForm";
import type { VenueFormRaw } from "../domain/venueForm";
import { decideAnyAccess } from "../domain/access";
import { decideVenueWrite } from "../domain/venueRules";
import { changedVenueFields, auditReason } from "../domain/venueAudit";
import type { StoredVenueFields } from "../domain/venueAudit";
import { serializeJsonFacilities } from "../domain/types";
import type { Actor } from "../domain/permissions";

const DUPLICATE_CODE_ERROR = "A venue with this code already exists";

export type { StoredVenueFields } from "../domain/venueAudit";

export type VenueFormErrors = FormErrors;

export type StoredVenue = StoredVenueFields & { id: string };

export type AuditDraft = {
  actorId: string;
  action: "VENUE_CREATE" | "VENUE_EDIT";
  reason: string;
};

export interface VenueStore {
  findVenue(id: string): Promise<StoredVenue | null>;
  findVenueByCode(code: string): Promise<{ id: string } | null>;
  departmentExists(id: string): Promise<boolean>;
  createVenue(
    fields: StoredVenueFields,
    audit: AuditDraft,
  ): Promise<{ id: string } | { conflict: true }>;
  updateVenue(
    id: string,
    fields: StoredVenueFields,
    audit: AuditDraft,
  ): Promise<{ ok: true } | { conflict: true } | { notFound: true }>;
}

export type VenueWriteRequest =
  | { op: "CREATE"; raw: VenueFormRaw }
  | { op: "EDIT"; venueId: string; raw: VenueFormRaw };

export type VenueWriteResult =
  | { ok: true; venueId: string; changed: boolean }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" }
  | { ok: false; kind: "VALIDATION"; errors: VenueFormErrors };

export async function performVenueWrite(
  store: VenueStore,
  actor: Actor | null,
  request: VenueWriteRequest,
): Promise<VenueWriteResult> {
  // 1. actor null
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  // 2. role-level any access before validation
  const anyAccess = decideAnyAccess(actor, "DECLARE_VENUE");
  if (anyAccess.status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  // 3. parse form
  const parsed = parseVenueForm(request.raw);
  if (!parsed.ok) {
    return { ok: false, kind: "VALIDATION", errors: parsed.errors };
  }

  // 4. current venue
  let current: StoredVenue | null = null;
  if (request.op === "EDIT") {
    current = await store.findVenue(request.venueId);
    if (current === null) {
      return { ok: false, kind: "NOT_FOUND" };
    }
  }

  // 5. decideVenueWrite
  const target =
    current !== null ? { ownerDepartmentId: current.ownerDepartmentId } : null;
  const proposedOwner = parsed.value.ownerDepartmentId;
  const decision = decideVenueWrite(actor, request.op, target, proposedOwner);
  if (decision.status !== "ALLOW") {
    if (decision.status === "UNAUTHENTICATED") {
      return { ok: false, kind: "UNAUTHENTICATED" };
    }
    return { ok: false, kind: "FORBIDDEN" };
  }

  // 6. department exists
  if (proposedOwner !== null && !(await store.departmentExists(proposedOwner))) {
    return { ok: false, kind: "VALIDATION", errors: { owner: "Unknown department" } };
  }

  // 7. duplicate code
  const found = await store.findVenueByCode(parsed.value.code);
  const isDup =
    found !== null &&
    (request.op === "CREATE" || found.id !== request.venueId);
  if (isDup) {
    return {
      ok: false,
      kind: "VALIDATION",
      errors: { code: DUPLICATE_CODE_ERROR },
    };
  }

  // 8. build fields
  const newFields: StoredVenueFields = {
    code: parsed.value.code,
    type: parsed.value.type,
    capacity: parsed.value.capacity,
    ownerDepartmentId: proposedOwner,
    facilities: serializeJsonFacilities(parsed.value.facilities),
    status: parsed.value.status,
  };

  if (request.op === "CREATE") {
    const audit = {
      actorId: actor.id,
      action: "VENUE_CREATE" as const,
      reason: auditReason("CREATE", []),
    };
    const result = await store.createVenue(newFields, audit);
    if ("conflict" in result) {
      return {
        ok: false,
        kind: "VALIDATION",
        errors: { code: DUPLICATE_CODE_ERROR },
      };
    }
    return { ok: true, venueId: result.id, changed: true };
  }

  // EDIT
  const changed = changedVenueFields(current as StoredVenueFields, newFields);
  if (changed.length === 0) {
    return { ok: true, venueId: request.venueId, changed: false };
  }
  const audit = {
    actorId: actor.id,
    action: "VENUE_EDIT" as const,
    reason: auditReason("EDIT", changed),
  };
  const result = await store.updateVenue(request.venueId, newFields, audit);
  if ("conflict" in result) {
    return {
      ok: false,
      kind: "VALIDATION",
      errors: { code: DUPLICATE_CODE_ERROR },
    };
  }
  if ("notFound" in result) {
    return { ok: false, kind: "NOT_FOUND" };
  }
  return { ok: true, venueId: request.venueId, changed: true };
}