"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitDepartmentalSubmissionAction } from "@/app/submissions/actions";

type Props = {
  submissionId: string;
  label: "Submit" | "Resubmit";
};

function failureMessage(result: Exclude<
  Awaited<ReturnType<typeof submitDepartmentalSubmissionAction>>,
  { ok: true }
>): string {
  switch (result.kind) {
    case "VALIDATION":
      return result.message;
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in and try again.";
    case "FORBIDDEN":
      return "You are not allowed to submit this department's submission.";
    case "NOT_FOUND":
      return "This submission could not be found. Refresh the page and try again.";
    case "INVALID_STATE":
      return "This submission is no longer eligible. Refresh the page to see its current status.";
    case "CONFLICT":
      return "This submission changed while you were submitting it. Refresh the page and try again.";
    case "INTERNAL_ERROR":
      return "The submission could not be saved. Please try again.";
  }
}

export function SubmissionActionButton({ submissionId, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const result = await submitDepartmentalSubmissionAction({ submissionId });
      if (result.ok) {
        setFeedback({ ok: true, message: "Submission sent for review." });
        router.refresh();
      } else {
        setFeedback({ ok: false, message: failureMessage(result) });
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Submitting…" : label}
      </button>
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
