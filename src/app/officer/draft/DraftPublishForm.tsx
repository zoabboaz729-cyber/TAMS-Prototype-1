"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ValidationOutcome } from "@/domain/validator";
import type { DraftPublishResult, PublishDraftRequest } from "@/server/draftPublishContract";
import { publishDraftAction } from "@/app/officer/draft/publishActions";
import { PublishResultPanel } from "./DraftPublishOutcome";

/**
 * Officer publication controls (M4-T3c2) over the accepted `publishDraftAction`
 * → `performDraftPublish` → M4-T3b atomic adapter. The wording of every typed
 * outcome lives in `DraftPublishOutcome.tsx`; this module holds the readiness
 * display, the two-step confirmation and the request shape.
 *
 * Nothing here is a security boundary. The action re-checks origin, session and
 * `PUBLISH_TIMETABLE`, and the service re-decides them, re-validates the draft
 * with the accepted M3 validator and re-computes its snapshot fingerprint inside
 * the transaction — so an officer who sends a request the page said was eligible
 * still gets a refusal if the data no longer supports it. This module only
 * decides whether to OFFER the confirmation, never whether publication happens.
 *
 * One request per confirmed click: `pending` disables both confirmation
 * controls and `confirmPublication()` returns early while it is set, no
 * publication runs on mount or on a page refresh (nothing here is in an effect),
 * and a refusal is never retried automatically. Publication is never started by
 * the page or by a query parameter — only by this explicit confirm click.
 */

/** Requirement 3: the consequence the officer must read before confirming. */
export const PUBLISH_ARCHIVE_EXPLANATION =
  "Publishing makes this version the current published timetable for its semester. " +
  "Previously published versions for that semester will be archived.";

/** Requirement 2: the eligibility claim is exactly what the accepted check says. */
export const PUBLISH_ELIGIBILITY_NOTE =
  "Eligible means the latest server-side check of these rows found no hard violation. It does not " +
  "claim every weekly teaching session is scheduled — publication does not enforce that separate " +
  "completeness policy. The server validates the draft again when you confirm.";

export type PublishReadiness =
  | { state: "eligible"; reason: string }
  | { state: "blocked"; reason: string; details: string[] };

/**
 * Publication readiness, read straight off the M3 validation outcome the page
 * already loaded — no second validation algorithm lives here. Zero entries and
 * an unfinished check are both blocked: an incomplete outcome with no detected
 * violations is NOT a clean draft (the accepted M3-T2b2a rule).
 */
export function decidePublishReadiness(validation: ValidationOutcome, entryCount: number): PublishReadiness {
  if (entryCount === 0) {
    return { state: "blocked", reason: "This draft holds no entries, so there is no timetable to publish.", details: [] };
  }
  if (validation.status === "incomplete") {
    return {
      state: "blocked",
      reason: `Validation could not finish — ${validation.missingContext.length === 1 ? "1 entry is" : `${validation.missingContext.length} entries are`} missing data the checks need — so publication stays blocked.`,
      details: [...validation.violations.map((v) => v.message), ...validation.missingContext.map((m) => m.message)],
    };
  }
  if (validation.violations.length > 0) {
    return {
      state: "blocked",
      reason: `${validation.violations.length === 1 ? "1 hard violation" : `${validation.violations.length} hard violations`} must be cleared before this draft can be published.`,
      details: validation.violations.map((v) => v.message),
    };
  }
  return { state: "eligible", reason: "The latest server-side check of this draft found no hard violations." };
}

/** The complete browser payload: one key, taken from server props. */
export function buildPublishRequest(versionId: string): PublishDraftRequest {
  return { versionId };
}

/**
 * What the panel's request line may claim. After a refusal the panel must not
 * say nothing was sent, and after a committed publication it must not imply the
 * officer still has to act.
 */
export function describeRequestState(pending: boolean, result: DraftPublishResult | null): string {
  if (pending) return "Publication request in progress";
  if (result === null) return "No request has been sent yet";
  return result.ok
    ? "The server committed this publication — reloading the published page state."
    : "A publication request was sent and refused — nothing was published.";
}

/**
 * The readiness sentence. It always reports the M3 outcome the page loaded, and
 * when a refusal is on screen it says so, because that refusal is the server's
 * own later check disagreeing with this one.
 */
export function describeReadinessSentence(readiness: PublishReadiness, refusalShown: boolean): string {
  if (readiness.state === "blocked") return `Publication is blocked: ${readiness.reason}`;
  if (!refusalShown) return `${readiness.reason} ${PUBLISH_ELIGIBILITY_NOTE}`;
  return `At your last reload of this draft the checks found no hard violation, and the server's own check when you confirmed reached a different conclusion — see the refusal below. ${PUBLISH_ELIGIBILITY_NOTE}`;
}

export type PublishGate = { readiness: PublishReadiness; confirming: boolean; pending: boolean };

/** Requirement 5: eligible + explicitly confirming + nothing already in flight. */
export function canConfirmPublish(gate: PublishGate): boolean {
  return gate.readiness.state === "eligible" && gate.confirming && !gate.pending;
}

/** The step-1 control is only offered for an eligible draft with no request running. */
export function canOpenConfirmation(gate: PublishGate): boolean {
  return gate.readiness.state === "eligible" && !gate.pending;
}

/** `?published=` — the verified page state is a server render, never this client. */
function publishedUrl(versionId: string): string {
  return `/officer/draft?published=${encodeURIComponent(versionId)}`;
}

const primaryButton =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton =
  "rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60";

export type PublishFacts = { versionId: string; semester: number; entryCount: number };

/** Version, semester, entry count and the status the server loaded. */
export function PublishVersionFacts({ facts, requestState, emphasise }: { facts: PublishFacts; requestState: string; emphasise: boolean }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
      <li>Version <span className="font-semibold">{facts.versionId}</span></li>
      <li>Semester {facts.semester}</li>
      <li>{facts.entryCount} {facts.entryCount === 1 ? "entry" : "entries"}</li>
      <li>Current status: <span className="font-semibold">DRAFT</span> (editable)</li>
      <li className={emphasise ? "font-semibold text-indigo-800" : "text-slate-500"}>{requestState}</li>
    </ul>
  );
}

export type PublishConfirmationProps = PublishFacts & {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Step 2 of the interaction: an inline, accessible confirmation state — no
 * browser dialog. It restates exactly what will change, and while a request is
 * in flight both controls are disabled so a second click cannot schedule a
 * second publication. Cancel only closes this state; it calls nothing.
 */
export function PublishConfirmationPanel({ versionId, semester, entryCount, pending, onConfirm, onCancel }: PublishConfirmationProps) {
  return (
    <section
      aria-labelledby="publish-confirm-heading"
      className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
    >
      <h3 id="publish-confirm-heading" className="text-sm font-semibold text-red-800">
        Confirm publication
      </h3>
      <p className="mt-1 text-xs text-red-800">{PUBLISH_ARCHIVE_EXPLANATION}</p>
      <p role="status" aria-live="polite" className="mt-2 text-xs font-medium text-red-900">
        {pending
          ? "Publishing… the request is running; this panel cannot be used again until it finishes."
          : `Nothing has been published yet. Confirming publishes version ${versionId} of semester ${semester} (${entryCount} ${entryCount === 1 ? "entry" : "entries"}) and archives the version now published for that semester.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={onConfirm} disabled={pending} className={dangerButton}>
          {pending ? "Publishing…" : "Confirm publication"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </section>
  );
}

type DraftPublishFormProps = PublishFacts & {
  /** The M3 outcome the page just loaded on the server. Read-only here. */
  validation: ValidationOutcome;
};

export function DraftPublishForm({ versionId, semester, entryCount, validation }: DraftPublishFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DraftPublishResult | null>(null);
  const readiness = decidePublishReadiness(validation, entryCount);
  const facts = { versionId, semester, entryCount };
  const refusalShown = result !== null && !result.ok;

  function openConfirmation() {
    if (!canOpenConfirmation({ readiness, confirming, pending })) return;
    setResult(null);
    setConfirming(true);
  }

  function confirmPublication() {
    // Requirement 5 — the gate is checked here as well as through `disabled`,
    // so a second click during the transition cannot start another request.
    if (!canConfirmPublish({ readiness, confirming, pending })) return;
    startTransition(async () => {
      try {
        const outcome = await publishDraftAction(buildPublishRequest(versionId));
        setConfirming(false);
        setResult(outcome);
        if (outcome.ok) {
          // Only the committed version id the service returned is navigated to,
          // and the page must re-read it as PUBLISHED before it says anything.
          router.push(publishedUrl(outcome.versionId));
          return;
        }
        // Requirement 8: reload the server state for the kinds where the stored
        // rows moved, never re-publish, and keep the explanation on screen.
        if (outcome.kind === "STALE" || outcome.kind === "NOT_DRAFT" || outcome.kind === "VERSION_NOT_FOUND") {
          router.refresh();
        }
      } catch {
        // A rejected action promise can carry server detail, so nothing derived
        // from it is logged or shown (M4-T3b1 rule for this path).
        console.error("[officer/draft] publication request did not complete");
        setConfirming(false);
        setResult({ ok: false, kind: "INTERNAL_ERROR" });
      }
    });
  }

  return (
    <section aria-labelledby="publish-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 id="publish-heading" className="text-sm font-semibold text-slate-800">
        Publish this draft
      </h2>
      <PublishVersionFacts facts={facts} requestState={describeRequestState(pending, result)} emphasise={pending || refusalShown} />
      <p className="mt-2 text-xs text-slate-600">{PUBLISH_ARCHIVE_EXPLANATION}</p>

      {readiness.state === "blocked" ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p role="alert" aria-live="assertive" className="text-xs font-semibold text-amber-900">
            {describeReadinessSentence(readiness, refusalShown)}
          </p>
          {readiness.details.length > 0 && (
            <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-900">
              {readiness.details.map((detail, index) => (
                <li key={`${index}-${detail}`} className="break-words">{detail}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">{describeReadinessSentence(readiness, refusalShown)}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!confirming && (
          <button
            type="button"
            onClick={openConfirmation}
            disabled={pending || readiness.state === "blocked"}
            className={primaryButton}
          >
            Publish timetable
          </button>
        )}
        {pending && !confirming && (
          <p role="status" aria-live="polite" className="text-xs text-slate-600">
            Waiting for the publication request to finish…
          </p>
        )}
      </div>

      {confirming && (
        <PublishConfirmationPanel
          {...facts}
          pending={pending}
          onConfirm={confirmPublication}
          onCancel={() => setConfirming(false)}
        />
      )}

      <PublishResultPanel result={result} />
    </section>
  );
}
