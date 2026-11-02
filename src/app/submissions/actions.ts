"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { NOTE_MAX, NOTE_MIN_FOR_RETURN } from "@/domain/submissionRules";
import { getCurrentUser } from "@/server/auth";
import { isSameOriginRequest } from "@/server/origin";
import { createPrismaSubmissionStore } from "@/server/submissionStorePrisma";
import {
  performSubmissionWrite,
  type SubmissionWriteResult,
} from "@/server/submissionWrite";

const SubmissionIdInputSchema = z.object({
  submissionId: z.string().trim().min(1).max(100),
});

const ReturnReasonSchema = z
  .string()
  .trim()
  .min(NOTE_MIN_FOR_RETURN)
  .max(NOTE_MAX);

type SubmissionActionResult =
  | SubmissionWriteResult
  | {
      ok: false;
      kind: "VALIDATION";
      reason: "INVALID_SUBMISSION_ID" | "NOTE_REQUIRED" | "NOTE_TOO_LONG";
      message: string;
    }
  | { ok: false; kind: "INTERNAL_ERROR" };

function invalidSubmissionId(): SubmissionActionResult {
  return {
    ok: false,
    kind: "VALIDATION",
    reason: "INVALID_SUBMISSION_ID",
    message: "The submission id is invalid. Reload and try again.",
  };
}

function invalidReturnReason(
  reason: "NOTE_REQUIRED" | "NOTE_TOO_LONG",
): SubmissionActionResult {
  return reason === "NOTE_TOO_LONG"
    ? {
        ok: false,
        kind: "VALIDATION",
        reason,
        message: "The return reason must be no more than 500 characters after trimming.",
      }
    : {
        ok: false,
        kind: "VALIDATION",
        reason,
        message: "The return reason must contain at least 3 characters after trimming.",
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

async function writeSubmission(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  request: Parameters<typeof performSubmissionWrite>[2],
): Promise<SubmissionActionResult> {
  try {
    return await performSubmissionWrite(
      createPrismaSubmissionStore(),
      user,
      request,
    );
  } catch (error) {
    console.error(
      "[submissions] action failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}

async function authenticatedUser(): Promise<
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> }
  | { ok: false; result: SubmissionActionResult }
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

export async function submitDepartmentalSubmissionAction(
  input: unknown,
): Promise<SubmissionActionResult> {
  const auth = await authenticatedUser();
  if (!auth.ok) return auth.result;

  const parsed = SubmissionIdInputSchema.safeParse(input);
  if (!parsed.success) return invalidSubmissionId();

  return writeSubmission(auth.user, {
    submissionId: parsed.data.submissionId,
    action: "SUBMIT",
  });
}

export async function approveDepartmentalSubmissionAction(
  input: unknown,
): Promise<SubmissionActionResult> {
  const auth = await authenticatedUser();
  if (!auth.ok) return auth.result;

  const parsed = SubmissionIdInputSchema.safeParse(input);
  if (!parsed.success) return invalidSubmissionId();

  return writeSubmission(auth.user, {
    submissionId: parsed.data.submissionId,
    action: "APPROVE",
  });
}

export async function returnDepartmentalSubmissionAction(
  input: unknown,
): Promise<SubmissionActionResult> {
  const auth = await authenticatedUser();
  if (!auth.ok) return auth.result;

  const parsedId = SubmissionIdInputSchema.safeParse(input);
  if (!parsedId.success) return invalidSubmissionId();

  const rawReason =
    typeof input === "object" && input !== null && "reason" in input
      ? input.reason
      : undefined;
  const parsedReason = ReturnReasonSchema.safeParse(rawReason);
  if (!parsedReason.success) {
    return invalidReturnReason(
      typeof rawReason === "string" && rawReason.trim().length > NOTE_MAX
        ? "NOTE_TOO_LONG"
        : "NOTE_REQUIRED",
    );
  }

  return writeSubmission(auth.user, {
    submissionId: parsedId.data.submissionId,
    action: "RETURN",
    note: parsedReason.data,
  });
}
