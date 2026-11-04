/**
 * Server-side persistence for lecturer unavailable periods (M2-T3c).
 *
 * Security rules enforced here, not in the UI:
 * - Ownership comes from the authenticated actor's user id resolved through the
 *   Lecturer profile. A browser-supplied lecturer/user id is never authority.
 * - Writes require SET_LECTURER_AVAILABILITY (SELF scope -> lecturers only).
 *   Officers and admins hold only VIEW_LECTURER_AVAILABILITY (ALL) and can
 *   never add or remove records.
 * - Reads require VIEW_LECTURER_AVAILABILITY for the subject (SELF for a
 *   lecturer's own rows, ALL for officers/admins).
 *
 * Validation and conflict rules stay in the pure domain layer
 * (src/domain/lecturerAvailability.ts); this file only orchestrates
 * persistence around them. The store is injected so the logic is testable
 * without a database; the Prisma implementation uses the existing
 * Lecturer / LecturerAvailability models (no migration).
 */
import { decideAccess } from "@/domain/access";
import {
  canAct,
  type Actor,
  type Resource,
} from "@/domain/permissions";
import {
  decideNewUnavailablePeriod,
  unavailablePeriodsFromRecords,
  type PeriodErrors,
  type StoredUnavailablePeriod,
  type UnavailablePeriod,
} from "@/domain/lecturerAvailability";
import type { Day } from "@/domain/types";
import { prisma } from "@/server/db";

/** A lecturer's profile as far as availability ownership is concerned. */
export type LecturerProfile = {
  lecturerId: string;
  lecturerUserId: string;
};

/** One unavailable period as stored, tagged with the owning lecturer's user id. */
export type LecturerAvailabilityRecord = {
  id: string;
  lecturerId: string;
  lecturerUserId: string;
  day: string;
  start: string;
  end: string;
  available: boolean;
};

/**
 * Minimal availability shape for the lecturer page (M2-T3d) and the M3
 * validator: lecturer id plus day/time periods only. The lecturer's user id
 * stays in the internal persistence record (permission checks) and is never
 * returned.
 */
export type LecturerAvailabilityView = {
  lecturerId: string;
  periods: StoredUnavailablePeriod[];
};

export interface LecturerAvailabilityStore {
  findLecturerByUserId(userId: string): Promise<LecturerProfile | null>;
  findRecord(availabilityId: string): Promise<LecturerAvailabilityRecord | null>;
  listUnavailableRecordsByLecturerId(lecturerId: string): Promise<LecturerAvailabilityRecord[]>;
  listAllUnavailableRecords(): Promise<LecturerAvailabilityRecord[]>;
  createUnavailablePeriod(
    lecturerId: string,
    period: UnavailablePeriod,
  ): Promise<{ id: string }>;
  deleteRecord(availabilityId: string): Promise<void>;
}

/** Period rows keep the domain shape and gain the row id for removals. */
export type LecturerPeriodRow = UnavailablePeriod & { id: string };

export type AddUnavailableResult =
  | { ok: true; period: LecturerPeriodRow }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "NO_LECTURER_PROFILE" | "INTERNAL_ERROR" }
  | { ok: false; kind: "INVALID"; errors: PeriodErrors }
  | {
      ok: false;
      kind: "DUPLICATE" | "OVERLAP";
      conflictingPeriod: StoredUnavailablePeriod;
      message: string;
    };

export type RemoveAvailabilityResult =
  | { ok: true; id: string }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR" }
  | { ok: false; kind: "INVALID"; errors: PeriodErrors };

export type LoadAvailabilityResult =
  | { ok: true; views: LecturerAvailabilityView[] }
  | { ok: false; kind: "UNAUTHENTICATED" | "FORBIDDEN" | "INTERNAL_ERROR" };

const DAY_LABELS: Record<Day, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

function periodLabel(period: { day: Day; start: string; end: string }): string {
  return `${DAY_LABELS[period.day]} ${period.start}-${period.end}`;
}

function conflictMessage(
  kind: "DUPLICATE" | "OVERLAP",
  existing: StoredUnavailablePeriod,
): string {
  return kind === "DUPLICATE"
    ? `You already have this period: ${periodLabel(existing)}`
    : `${periodLabel(existing)} is already marked unavailable. Choose a time that does not overlap it.`;
}

/**
 * The write permission is keyed on the actor's own user id: SELF resolves to
 * "subjectUserId === actor.id", so only a lecturer writing their own rows
 * passes. Officers/admins have SET scope NONE and fail here before any query.
 */
function canWriteOwnAvailability(actor: Actor): boolean {
  const resource: Resource = { subjectUserId: actor.id };
  return canAct(actor, "SET_LECTURER_AVAILABILITY", resource);
}

function viewFor(
  lecturerId: string,
  records: readonly LecturerAvailabilityRecord[],
): LecturerAvailabilityView {
  return {
    lecturerId,
    periods: unavailablePeriodsFromRecords(records),
  };
}

/**
 * Save a new unavailable period for the authenticated lecturer.
 * Input is untrusted (day/start/end only); the owning lecturer is resolved
 * from the actor's user id, never from the input. The decision (duplicate,
 * overlap, malformed) is made by the pure domain rules before any write.
 */
export async function performAddUnavailablePeriod(
  store: LecturerAvailabilityStore,
  actor: Actor | null,
  raw: unknown,
): Promise<AddUnavailableResult> {
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }
  if (!canWriteOwnAvailability(actor)) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  try {
    const profile = await store.findLecturerByUserId(actor.id);
    if (profile === null) {
      return { ok: false, kind: "NO_LECTURER_PROFILE" };
    }

    const existing = await store.listUnavailableRecordsByLecturerId(profile.lecturerId);
    const storedExisting = unavailablePeriodsFromRecords(existing);

    const decision = decideNewUnavailablePeriod(raw, storedExisting);
    if (decision.status === "INVALID") {
      return { ok: false, kind: "INVALID", errors: decision.errors };
    }
    if (decision.status === "DUPLICATE" || decision.status === "OVERLAPS") {
      const kind = decision.status === "DUPLICATE" ? "DUPLICATE" : "OVERLAP";
      return {
        ok: false,
        kind,
        conflictingPeriod: decision.conflictingPeriod,
        message: conflictMessage(kind, decision.conflictingPeriod),
      };
    }

    const created = await store.createUnavailablePeriod(profile.lecturerId, decision.period);
    return {
      ok: true,
      period: { ...decision.period, id: created.id },
    };
  } catch (error) {
    console.error(
      "[lecturerAvailability] add failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

/**
 * Remove one unavailable period. The id only selects the row; ownership is
 * verified from the stored record's lecturer -> user relation after the
 * permission check, so a forged id pointing at another lecturer is FORBIDDEN
 * and an officer/admin id is rejected by the SET check.
 */
export async function performRemoveUnavailablePeriod(
  store: LecturerAvailabilityStore,
  actor: Actor | null,
  availabilityId: string,
): Promise<RemoveAvailabilityResult> {
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }
  if (!canWriteOwnAvailability(actor)) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  try {
    const record = await store.findRecord(availabilityId);
    if (record === null) {
      return { ok: false, kind: "NOT_FOUND" };
    }

    const resource: Resource = { subjectUserId: record.lecturerUserId };
    if (!canAct(actor, "SET_LECTURER_AVAILABILITY", resource)) {
      return { ok: false, kind: "FORBIDDEN" };
    }

    await store.deleteRecord(record.id);
    return { ok: true, id: record.id };
  } catch (error) {
    console.error(
      "[lecturerAvailability] remove failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

/**
 * Availability for one subject lecturer, gated by
 * VIEW_LECTURER_AVAILABILITY: a lecturer sees only their own rows (SELF),
 * officers/admins see any subject (ALL), everyone else is FORBIDDEN.
 * The permission check runs BEFORE any store query, so a denied caller sees
 * the same FORBIDDEN for a nonexistent subject as for a real one (no
 * existence oracle) and no data is read.
 */
export async function loadLecturerAvailability(
  store: LecturerAvailabilityStore,
  actor: Actor | null,
  subjectUserId: string,
): Promise<LoadAvailabilityResult> {
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  const resource: Resource = { subjectUserId };
  if (!canAct(actor, "VIEW_LECTURER_AVAILABILITY", resource)) {
    return { ok: false, kind: "FORBIDDEN" };
  }

  try {
    const profile = await store.findLecturerByUserId(subjectUserId);
    if (profile === null) {
      return { ok: true, views: [] };
    }

    const records = await store.listUnavailableRecordsByLecturerId(profile.lecturerId);
    return { ok: true, views: [viewFor(profile.lecturerId, records)] };
  } catch (error) {
    console.error(
      "[lecturerAvailability] load failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

/**
 * Availability for every lecturer with at least one stored period — the shape
 * M3 validation consumes. Requires VIEW_LECTURER_AVAILABILITY with ALL scope,
 * so lecturers (SELF) and all other roles are rejected.
 */
export async function loadAllLecturerAvailability(
  store: LecturerAvailabilityStore,
  actor: Actor | null,
): Promise<LoadAvailabilityResult> {
  if (actor === null) {
    return { ok: false, kind: "UNAUTHENTICATED" };
  }

  const allScope = decideAccess(actor, "VIEW_LECTURER_AVAILABILITY", { subjectUserId: "any" });
  if (allScope.status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  try {
    const records = await store.listAllUnavailableRecords();
    const byLecturerId = new Map<string, LecturerAvailabilityRecord[]>();
    for (const record of records) {
      const bucket = byLecturerId.get(record.lecturerId);
      if (bucket === undefined) {
        byLecturerId.set(record.lecturerId, [record]);
      } else {
        bucket.push(record);
      }
    }

    const views: LecturerAvailabilityView[] = [];
    for (const [lecturerId, lecturerRecords] of byLecturerId) {
      views.push(viewFor(lecturerId, lecturerRecords));
    }
    return { ok: true, views };
  } catch (error) {
    console.error(
      "[lecturerAvailability] load all failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

const recordSelect = {
  id: true,
  lecturerId: true,
  day: true,
  start: true,
  end: true,
  available: true,
  lecturer: { select: { userId: true } },
} as const;

type AvailabilityRow = {
  id: string;
  lecturerId: string;
  day: string;
  start: string;
  end: string;
  available: boolean;
  lecturer: { userId: string };
};

function toRecord(row: AvailabilityRow): LecturerAvailabilityRecord {
  return {
    id: row.id,
    lecturerId: row.lecturerId,
    lecturerUserId: row.lecturer.userId,
    day: row.day,
    start: row.start,
    end: row.end,
    available: row.available,
  };
}

const unavailableWhere = { available: false } as const;

/** Prisma implementation over the existing models — no schema migration. */
export function createLecturerAvailabilityStore(): LecturerAvailabilityStore {
  return {
    async findLecturerByUserId(userId) {
      const lecturer = await prisma.lecturer.findUnique({
        where: { userId },
        select: { id: true, userId: true },
      });
      if (lecturer === null) return null;
      return { lecturerId: lecturer.id, lecturerUserId: lecturer.userId };
    },

    async findRecord(availabilityId) {
      const row = await prisma.lecturerAvailability.findUnique({
        where: { id: availabilityId },
        select: recordSelect,
      });
      return row === null ? null : toRecord(row);
    },

    async listUnavailableRecordsByLecturerId(lecturerId) {
      const rows = await prisma.lecturerAvailability.findMany({
        where: { lecturerId, ...unavailableWhere },
        orderBy: [{ day: "asc" }, { start: "asc" }],
        select: recordSelect,
      });
      return rows.map(toRecord);
    },

    async listAllUnavailableRecords() {
      const rows = await prisma.lecturerAvailability.findMany({
        where: unavailableWhere,
        orderBy: [{ lecturerId: "asc" }, { day: "asc" }, { start: "asc" }],
        select: recordSelect,
      });
      return rows.map(toRecord);
    },

    async createUnavailablePeriod(lecturerId, period) {
      const created = await prisma.lecturerAvailability.create({
        data: {
          lecturerId,
          day: period.day,
          start: period.start,
          end: period.end,
          available: false,
        },
        select: { id: true },
      });
      return { id: created.id };
    },

    async deleteRecord(availabilityId) {
      await prisma.lecturerAvailability.delete({ where: { id: availabilityId } });
    },
  };
}
