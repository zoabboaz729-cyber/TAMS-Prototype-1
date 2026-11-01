import type { Actor } from "./permissions";
import { SHARED_OWNER_VALUE } from "./venueForm";
import type { DepartmentRef } from "./venueRegister";
import { decideVenueWrite } from "./venueRules";
import type { VenueTarget } from "./venueRules";

export type OwnerOption = { value: string; label: string };

export function ownerOptionsFor(
  actor: Actor | null,
  departments: DepartmentRef[],
  op: "CREATE" | "EDIT",
  current: VenueTarget | null,
): OwnerOption[] {
  const candidates: {
    option: OwnerOption;
    ownerDepartmentId: string | null;
  }[] = [...departments]
    .map((department) => ({
      option: { value: department.id, label: department.name },
      ownerDepartmentId: department.id,
    }))
    .sort((a, b) =>
      a.option.label < b.option.label
        ? -1
        : a.option.label > b.option.label
          ? 1
          : 0,
    );

  candidates.push({
    option: { value: SHARED_OWNER_VALUE, label: "Shared (no owner)" },
    ownerDepartmentId: null,
  });

  return candidates
    .filter(
      (candidate) =>
        decideVenueWrite(
          actor,
          op,
          op === "EDIT" ? current : null,
          candidate.ownerDepartmentId,
        ).status === "ALLOW",
    )
    .map((candidate) => candidate.option);
}
