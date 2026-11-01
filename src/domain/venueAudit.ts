import { parseJsonFacilities } from "./types";

export type StoredVenueFields = {
  code: string;
  type: string;
  capacity: number;
  ownerDepartmentId: string | null;
  facilities: string; // stored JSON string
  status: string;
};

const FIELD_ORDER = ["code", "type", "capacity", "facilities", "status", "owner"] as const;

export function changedVenueFields(
  before: StoredVenueFields,
  after: StoredVenueFields,
): string[] {
  const changed: string[] = [];

  if (before.code !== after.code) changed.push("code");
  if (before.type !== after.type) changed.push("type");
  if (before.capacity !== after.capacity) changed.push("capacity");

  // facilities compared as sets after parse
  const beforeFac = parseJsonFacilities(before.facilities);
  const afterFac = parseJsonFacilities(after.facilities);
  const beforeSet = new Set(beforeFac);
  const afterSet = new Set(afterFac);
  let facilitiesChanged = beforeSet.size !== afterSet.size;
  if (!facilitiesChanged) {
    for (const f of beforeSet) {
      if (!afterSet.has(f)) {
        facilitiesChanged = true;
        break;
      }
    }
  }
  if (facilitiesChanged) changed.push("facilities");

  if (before.status !== after.status) changed.push("status");
  if (before.ownerDepartmentId !== after.ownerDepartmentId) changed.push("owner");

  // Ensure fixed order
  const ordered: string[] = [];
  for (const field of FIELD_ORDER) {
    if (changed.includes(field)) ordered.push(field);
  }
  return ordered;
}

export function auditReason(
  op: "CREATE" | "EDIT",
  changed: string[],
): string {
  if (op === "CREATE") return "created";
  if (changed.length === 0) return "no changes";
  return "changed: " + changed.join(", ");
}