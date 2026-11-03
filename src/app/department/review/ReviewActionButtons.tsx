"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveDepartmentalSubmissionAction,
  returnDepartmentalSubmissionAction,
} from "@/app/submissions/actions";

type ReviewResult = Awaited<
  ReturnType<typeof approveDepartmentalSubmissionAction>
>;
type ReviewFailure = Exclude<ReviewResult, { ok: true }>;

function failureMessage(result: ReviewFailure): string {
  switch (result.kind) {
    case "VALIDATION":
      return result.message;
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in and try again.";
    case "FORBIDDEN":
      return "You are not allowed to review this department's submission.";
    case "NOT_FOUND":
      return "This submission could not be found. Refresh the page and try again.";
    case "INVALID_STATE":
      return "This submission is no longer eligible. Refresh the page to see its current status.";
    case "CONFLICT":
      return "This submission changed while you were reviewing it. Refresh the page and try again.";
    case "INTERNAL_ERROR":
      return "The submission could not be saved. Please try again.";
  }
}

export function ReviewActionButtons({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function runAction(action: "APPROVE" | "RETURN") {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result =
          action === "APPROVE"
            ? await approveDepartmentalSubmissionAction({ submissionId })
            : await returnDepartmentalSubmissionAction({ submissionId, reason });
        if (result.ok) {
          setFeedback({
            ok: true,
            message:
              action === "APPROVE"
                ? "Submission approved."
                : "Submission returned to the department.",
          });
          router.refresh();
        } else {
          setFeedback({ ok: false, message: failureMessage(result) });
        }
      } catch (error) {
        console.error(
          "[department-review] action request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        setFeedback({
          ok: false,
          message: "The review could not be completed. Refresh the page and try again.",
        });
      }
    });
  }

  return (
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto">
      <label
        htmlFor={`return-reason-${submissionId}`}
        className="text-sm font-medium text-slate-700"
      >
        Return reason
      </label>
      <textarea
        id={`return-reason-${submissionId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        disabled={pending}
        rows={3}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 sm:w-80"
        aria-describedby={`return-reason-hint-${submissionId}`}
      />
      <p id={`return-reason-hint-${submissionId}`} className="text-xs text-slate-500">
        Required only when returning; use 3–500 characters.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => runAction("APPROVE")}
          disabled={pending}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Processing…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={() => runAction("RETURN")}
          disabled={pending}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Processing…" : "Return"}
        </button>
      </div>
      {feedback && (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={`text-sm ${feedback.ok ? "text-green-700" : "text-red-700"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
