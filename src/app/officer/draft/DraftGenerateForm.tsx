"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateDraftAction } from "@/app/officer/draft/generateActions";
import type {
  DraftGenerateResult,
  GenerateDraftRequest,
} from "@/server/draftGenerateContract";
import { GenerateResultPanel } from "./DraftGenerateOutcome";

/**
 * Officer generate-draft controls (M4-T2c2) over the accepted
 * `generateDraftAction` → `performDraftGenerate`. The wording of every outcome
 * lives in `DraftGenerateOutcome.tsx`; this module holds the request shape and
 * the controls.
 *
 * Nothing here is a security boundary: the action re-checks origin, session
 * and `GENERATE_TIMETABLE`, and the service re-decides them before its first
 * read. Two fields are ever submitted — a numeric semester and an optional
 * source version id (`GenerateDraftRequest`). No actor, role, creator, status,
 * lock flag, soft score or expected-source token crosses this boundary, and
 * the action's strict schema refuses a payload that carries one.
 *
 * One request per click: `pending` disables every control for the whole
 * transition and `submit()` returns early while it is set, so a double click
 * cannot start two writes. A failure is never retried automatically.
 */

/** One eligible generation source: an existing DRAFT version. */
export type DraftSourceOption = { id: string; semester: number };

/** ASSUMPTION-8: the prototype timetables semester 1 and semester 2. */
export const GENERATION_SEMESTERS: readonly number[] = [1, 2];

type SourceMode = "fresh" | "source";

const SOURCE_MODES: readonly { value: SourceMode; label: string }[] = [
  { value: "fresh", label: "Fresh draft — carry no locked rows over" },
  { value: "source", label: "From an existing draft — keep its locked entries" },
];

export type GenerateFormState = {
  /** The `<select>` value; `buildGenerateRequest` turns it into a number. */
  semester: string;
  mode: SourceMode;
  sourceVersionId: string;
};

/**
 * DRAFT versions that may feed this generation. The page's server query
 * already excluded PUBLISHED and ARCHIVED rows; the semester match is the
 * client-side half of a rule the service checks again, so an obviously
 * mismatched selection never reaches a write.
 */
export function eligibleDraftSources(
  sources: readonly DraftSourceOption[],
  semester: string,
): DraftSourceOption[] {
  return sources.filter((source) => String(source.semester) === semester);
}

/** The complete browser payload — two keys, the semester as a number. */
export function buildGenerateRequest(state: GenerateFormState): GenerateDraftRequest {
  const useSource = state.mode === "source" && state.sourceVersionId !== "";
  return {
    semester: Number(state.semester),
    sourceVersionId: useSource ? state.sourceVersionId : null,
  };
}

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100";
const labelClass = "text-sm font-medium text-slate-700";

type DraftSourceSelectProps = {
  semester: string;
  sources: readonly DraftSourceOption[];
  value: string;
  disabled: boolean;
  onChange: (versionId: string) => void;
};

/**
 * The eligible-source picker. Options come only from the page's DRAFT-only
 * query and are filtered to the chosen semester, so a published or archived
 * version is never offered as a source to carry locked rows over from.
 */
export function DraftSourceSelect({
  semester,
  sources,
  value,
  disabled,
  onChange,
}: DraftSourceSelectProps) {
  const eligible = eligibleDraftSources(sources, semester);
  return (
    <div className="flex min-w-56 flex-col gap-1">
      <label htmlFor="generate-source" className={labelClass}>
        Source draft
      </label>
      <select
        id="generate-source"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || eligible.length === 0}
        className={inputClass}
      >
        <option value="">
          {eligible.length === 0 ? "No draft in this semester" : "Choose a draft version"}
        </option>
        {eligible.map((source) => (
          <option key={source.id} value={source.id}>
            {source.id} · semester {source.semester}
          </option>
        ))}
      </select>
    </div>
  );
}

type DraftGenerateFormProps = {
  /** DRAFT versions only — the page's server query filters the rest out. */
  sources: DraftSourceOption[];
  /** Semester of the draft in view, so the page does not jump semesters. */
  defaultSemester: number;
};

export function DraftGenerateForm({ sources, defaultSemester }: DraftGenerateFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [semester, setSemester] = useState(
    GENERATION_SEMESTERS.includes(defaultSemester) ? String(defaultSemester) : "1",
  );
  const [mode, setMode] = useState<SourceMode>("fresh");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DraftGenerateResult | null>(null);
  const eligible = eligibleDraftSources(sources, semester);

  function changeSemester(next: string) {
    setSemester(next);
    setResult(null);
    const stillEligible = eligibleDraftSources(sources, next).some((s) => s.id === sourceVersionId);
    if (mode !== "source" || sourceVersionId === "" || stillEligible) {
      setNotice(null);
      return;
    }
    // Client-side guard only — the service refuses a mismatched source anyway.
    const count = eligibleDraftSources(sources, next).length;
    setSourceVersionId("");
    setNotice(
      `Source draft cleared: semester ${next} has ${count} ${count === 1 ? "draft" : "drafts"} whose locked rows can be carried over.`,
    );
  }

  function submit() {
    if (pending) return;
    if (mode === "source" && sourceVersionId === "") {
      setNotice("Choose the draft whose locked rows must be kept, or select a fresh draft.");
      return;
    }
    setNotice(null);
    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await generateDraftAction(
          buildGenerateRequest({ semester, mode, sourceVersionId }),
        );
        setResult(outcome);
        if (outcome.ok) {
          // The id the committed write returned is the only destination.
          router.push(`/officer/draft?version=${encodeURIComponent(outcome.versionId)}`);
          return;
        }
        // A stale token means the options this form was built from are gone.
        if (outcome.kind === "STALE") router.refresh();
      } catch (error) {
        console.error(
          "[officer/draft] generate request failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        setResult({ ok: false, kind: "INTERNAL_ERROR" });
      }
    });
  }

  return (
    <section
      aria-labelledby="generate-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <h2 id="generate-heading" className="text-sm font-semibold text-slate-800">
        Generate a draft timetable
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        Generation searches every scheduled teaching in one semester. A new draft is written only
        when each required session and each locked row is settled; otherwise the reason for every
        unresolved item is listed and nothing is saved.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-40 flex-col gap-1">
          <label htmlFor="generate-semester" className={labelClass}>
            Semester
          </label>
          <select
            id="generate-semester"
            value={semester}
            onChange={(event) => changeSemester(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            {GENERATION_SEMESTERS.map((value) => (
              <option key={value} value={String(value)}>
                Semester {value}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex min-w-56 flex-col gap-1 border-slate-200 pt-0.5" disabled={pending}>
          <legend className={labelClass}>Locked rows to keep</legend>
          {SOURCE_MODES.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="generate-source-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  setSourceVersionId("");
                  setNotice(null);
                }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        {mode === "source" && (
          <DraftSourceSelect
            semester={semester}
            sources={sources}
            value={sourceVersionId}
            disabled={pending}
            onChange={(versionId) => {
              setSourceVersionId(versionId);
              setNotice(null);
            }}
          />
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate draft"}
        </button>

        <p role="status" aria-live="polite" className="w-full text-xs text-slate-600">
          {pending
            ? "Generating the draft — one request, never retried automatically."
            : mode === "source" && eligible.length === 0
              ? `Semester ${semester} has no draft version yet, so locked rows cannot be carried over.`
              : ""}
        </p>
        {notice !== null && (
          <p role="alert" aria-live="assertive" className="w-full text-xs text-amber-800">
            {notice}
          </p>
        )}
      </form>

      <GenerateResultPanel result={result} />
    </section>
  );
}
