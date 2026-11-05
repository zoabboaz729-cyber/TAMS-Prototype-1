/**
 * Draft editor display rules (M3-T2b2a) — pure, testable, no React.
 *
 * The M3-T1a contract says an "incomplete" validation outcome can carry zero
 * detected violations because a check never ran. The officer must never read
 * that as a clean draft, so the summary decision lives here rather than in a
 * JSX ternary.
 *
 * Pairwise violations (VENUE_OVERLAP, LECTURER_OVERLAP, GROUP_OVERLAP) are
 * reported once by the validator and named against the earlier entry, with the
 * other entry in `conflictEntryId`. Both affected rows must show the clash,
 * so both ids are keyed here — the overall count still comes from the
 * violations array, so attaching to two rows never double-counts.
 */

import type { ValidationOutcome, Violation } from "./validator";

export type DraftSummaryTone = "success" | "danger" | "warning";

export type DraftSummary = {
  tone: DraftSummaryTone;
  text: string;
};

/**
 * Attach every violation message to each affected row, keeping first-seen
 * order and one copy of an identical message per row. The input array is never
 * mutated — the overall violation count stays `violations.length`.
 */
export function mapViolationsToRows(
  violations: readonly Violation[],
): Map<string, string[]> {
  const rows = new Map<string, Set<string>>();

  const attach = (rowId: string, message: string): void => {
    const bucket = rows.get(rowId);
    if (bucket === undefined) {
      rows.set(rowId, new Set([message]));
    } else {
      bucket.add(message);
    }
  };

  for (const violation of violations) {
    attach(violation.entryId, violation.message);
    // An absent conflictEntryId means the violation belongs to one entry only.
    if (violation.conflictEntryId !== undefined) {
      attach(violation.conflictEntryId, violation.message);
    }
  }

  const messages = new Map<string, string[]>();
  for (const [rowId, bucket] of rows) {
    messages.set(rowId, [...bucket]);
  }
  return messages;
}

function violationCountText(count: number): string {
  return `${count} hard violation${count === 1 ? "" : "s"}`;
}

/**
 * Decide the summary banner from the validation outcome.
 *
 * `success` requires status "ok" AND zero violations; an "incomplete" outcome
 * with zero violations is a `warning` saying validation could not finish, and
 * an "incomplete" outcome with violations labels them provisional.
 */
export function validationSummary(outcome: ValidationOutcome): DraftSummary {
  const count = outcome.violations.length;

  if (outcome.status === "incomplete") {
    return count === 0
      ? {
          tone: "warning",
          text:
            "Validation could not finish — some entries are missing the data the checks need. " +
            "No conflicts were detected, but this draft is NOT validated.",
        }
      : {
          tone: "warning",
          text:
            `Validation could not finish, so the ${violationCountText(count)} below are ` +
            "provisional — shown on the affected rows. This draft is NOT validated.",
        };
  }

  return count === 0
    ? { tone: "success", text: "No hard violations in this draft." }
    : {
        tone: "danger",
        text: `${violationCountText(count)} found — shown on the affected rows below.`,
      };
}
