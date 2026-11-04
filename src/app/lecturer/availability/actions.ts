"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  PERIOD_DAY_ERROR,
  PERIOD_REQUIRED_ERROR,
  PERIOD_TIME_ERROR,
} from "@/domain/lecturerAvailability";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import {
  createLecturerAvailabilityStore,
  performAddUnavailablePeriod,
  performRemoveUnavailablePeriod,
  type AddUnavailableResult,
  type RemoveAvailabilityResult,
} from "@/server/lecturerAvailability";

/**
 * Server actions for the lecturer availability form (M2-T3c).
 * The page UI arrives in M2-T3d; these actions are the secure entry points.
 *
 * Input is deliberately narrow: a period (day/start/end) or a record id.
 * There is no lecturerId/userId/role parameter — the acting user comes only
 * from the session cookie and ownership is resolved server-side.
 */

const AvailabilityIdSchema = z.string().trim().min(1).max(100);

/**
 * Failures the action layer itself can produce. Both kinds are members of
 * AddUnavailableResult and RemoveAvailabilityResult, so one helper serves
 * both actions without widening either result union.
 */
type ActionAuthFailure =
  | { ok: false; kind: "UNAUTHENTICATED" }
  | { ok: false; kind: "FORBIDDEN" };

function invalidPeriod(
  field: "day" | "start" | "end",
): AddUnavailableResult {
  const message =
    field === "day"
      ? PERIOD_DAY_ERROR
      : field === "start" || field === "end"
        ? PERIOD_TIME_ERROR
        : PERIOD_REQUIRED_ERROR;
  return { ok: false, kind: "INVALID", errors: { [field]: message } };
}

async function requestIsSameOrigin(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameOriginRequest({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    secFetchSite: requestHeaders.get("sec-fetch-site"),
  });
}

async function authorizedActor(): Promise<
  { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> } | { ok: false; result: ActionAuthFailure }
> {
  if (!(await requestIsSameOrigin())) {
    return { ok: false, result: { ok: false, kind: "FORBIDDEN" } };
  }
  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, result: { ok: false, kind: "UNAUTHENTICATED" } };
  }
  return { ok: true, user };
}

export async function addUnavailablePeriodAction(input: unknown): Promise<AddUnavailableResult> {
  const auth = await authorizedActor();
  if (!auth.ok) return auth.result;

  const source: Record<string, unknown> =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  if (Object.keys(source).length === 0) {
    return { ok: false, kind: "INVALID", errors: { period: PERIOD_REQUIRED_ERROR } };
  }

  // Reject unknown/malformed top-level fields before the domain rules run, so
  // forged keys (lecturerId, userId, role, ...) can never reach the store.
  const allowedFields = new Set(["day", "start", "end"]);
  for (const key of Object.keys(source)) {
    if (!allowedFields.has(key)) {
      return { ok: false, kind: "INVALID", errors: { period: PERIOD_REQUIRED_ERROR } };
    }
  }

  const day = typeof source.day === "string" ? source.day : undefined;
  const start = typeof source.start === "string" ? source.start : undefined;
  const end = typeof source.end === "string" ? source.end : undefined;
  if (day === undefined) return invalidPeriod("day");
  if (start === undefined) return invalidPeriod("start");
  if (end === undefined) return invalidPeriod("end");

  try {
    return await performAddUnavailablePeriod(createLecturerAvailabilityStore(), auth.user, {
      day,
      start,
      end,
    });
  } catch (error) {
    console.error(
      "[lecturerAvailability/action] add failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

export async function removeUnavailablePeriodAction(
  input: unknown,
): Promise<RemoveAvailabilityResult> {
  const auth = await authorizedActor();
  if (!auth.ok) return auth.result;

  const parsed = AvailabilityIdSchema.safeParse(
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).availabilityId
      : undefined,
  );
  if (!parsed.success) {
    return {
      ok: false,
      kind: "INVALID",
      errors: { period: "The availability id is invalid. Reload and try again." },
    };
  }

  try {
    return await performRemoveUnavailablePeriod(
      createLecturerAvailabilityStore(),
      auth.user,
      parsed.data,
    );
  } catch (error) {
    console.error(
      "[lecturerAvailability/action] remove failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
