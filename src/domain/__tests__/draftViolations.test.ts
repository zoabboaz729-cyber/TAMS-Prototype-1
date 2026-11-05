import { describe, it, expect } from "vitest";
import {
  mapViolationsToRows,
  validationSummary,
} from "../draftViolations";
import type { ValidationOutcome, Violation } from "../validator";

const VENUE_CLASH = "CR1 is used by two classes at the same time (MON 08:00-09:00).";
const LECTURER_CLASH = "Lecturer teaches two classes at the same time (MON 08:00-09:00).";
const CAPACITY = "CR1 holds 60 students but SOEN-400 expects 120.";

function pairwise(entryId: string, conflictEntryId: string): Violation {
  return {
    type: "VENUE_OVERLAP",
    entryId,
    conflictEntryId,
    message: VENUE_CLASH,
  };
}

describe("mapViolationsToRows — single-entry violations", () => {
  it("attaches a non-pairwise violation to its own row only", () => {
    const violations: Violation[] = [
      { type: "CAPACITY", entryId: "entry-a", message: CAPACITY },
    ];

    const rows = mapViolationsToRows(violations);

    expect([...rows.keys()]).toEqual(["entry-a"]);
    expect(rows.get("entry-a")).toEqual([CAPACITY]);
  });

  it("returns an empty map for an empty violation list", () => {
    expect(mapViolationsToRows([]).size).toBe(0);
  });

  it("keeps several distinct messages on one row in first-seen order", () => {
    const rows = mapViolationsToRows([
      { type: "CAPACITY", entryId: "entry-a", message: CAPACITY },
      { type: "OUT_OF_SLOT", entryId: "entry-a", message: "SAT is not a teaching day." },
    ]);

    expect(rows.get("entry-a")).toEqual([CAPACITY, "SAT is not a teaching day."]);
  });
});

describe("mapViolationsToRows — pairwise conflicts on both rows", () => {
  it("shows one pairwise violation on both affected entries", () => {
    const rows = mapViolationsToRows([pairwise("entry-a", "entry-b")]);

    expect(rows.get("entry-a")).toEqual([VENUE_CLASH]);
    expect(rows.get("entry-b")).toEqual([VENUE_CLASH]);
  });

  it("does not duplicate the conflict in the overall count", () => {
    const violations: Violation[] = [pairwise("entry-a", "entry-b")];
    const before = structuredClone(violations);

    const rows = mapViolationsToRows(violations);

    // The mapping never appends a second violation object, so the banner —
    // which counts violations.length — still reports one conflict...
    expect(violations).toEqual(before);
    expect(violations.length).toBe(1);
    expect(validationSummary({ status: "ok", violations }).text).toBe(
      "1 hard violation found — shown on the affected rows below.",
    );
    // ...even though both affected rows carry the message.
    expect(rows.get("entry-a")).toEqual([VENUE_CLASH]);
    expect(rows.get("entry-b")).toEqual([VENUE_CLASH]);
    expect([...rows.values()].flat().length).toBe(2);
  });

  it("shows each clash of one entry on that entry and on each opponent", () => {
    const rows = mapViolationsToRows([
      pairwise("entry-a", "entry-b"),
      { ...pairwise("entry-a", "entry-c"), type: "LECTURER_OVERLAP", message: LECTURER_CLASH },
    ]);

    expect(rows.get("entry-a")).toEqual([VENUE_CLASH, LECTURER_CLASH]);
    expect(rows.get("entry-b")).toEqual([VENUE_CLASH]);
    expect(rows.get("entry-c")).toEqual([LECTURER_CLASH]);
  });

  it("renders an identical clash only once on the same row", () => {
    const rows = mapViolationsToRows([
      pairwise("entry-a", "entry-b"),
      pairwise("entry-a", "entry-c"),
    ]);

    expect(rows.get("entry-a")).toEqual([VENUE_CLASH]);
    expect(rows.get("entry-b")).toEqual([VENUE_CLASH]);
    expect(rows.get("entry-c")).toEqual([VENUE_CLASH]);
  });

  it("treats a self-conflicting pair as one row entry, not two", () => {
    const rows = mapViolationsToRows([pairwise("entry-a", "entry-a")]);

    expect(rows.get("entry-a")).toEqual([VENUE_CLASH]);
    expect(rows.size).toBe(1);
  });
});

describe("validationSummary — status decides the banner", () => {
  it("reports success only for a complete draft with zero violations", () => {
    const outcome: ValidationOutcome = { status: "ok", violations: [] };

    expect(validationSummary(outcome)).toEqual({
      tone: "success",
      text: "No hard violations in this draft.",
    });
  });

  it("warns, and never claims clean, for an incomplete draft with zero violations", () => {
    const outcome: ValidationOutcome = {
      status: "incomplete",
      violations: [],
      missingContext: [
        {
          kind: "MISSING_VENUE",
          entryIndex: 0,
          entryId: "entry-a",
          refId: "venue-missing",
          message: 'Entry entry-a refers to venue "venue-missing", which is missing.',
        },
      ],
    };

    const summary = validationSummary(outcome);

    expect(summary.tone).toBe("warning");
    expect(summary.text).toContain("Validation could not finish");
    expect(summary.text).toContain("NOT validated");
    expect(summary.text).not.toContain("No hard violations");
  });

  it("labels detected violations as provisional when context is missing", () => {
    const outcome: ValidationOutcome = {
      status: "incomplete",
      violations: [{ type: "CAPACITY", entryId: "entry-a", message: CAPACITY }],
      missingContext: [
        {
          kind: "MISSING_TEACHING",
          entryIndex: 1,
          entryId: "entry-b",
          refId: "teaching-missing",
          message: 'Entry entry-b refers to teaching "teaching-missing", which is missing.',
        },
      ],
    };

    const summary = validationSummary(outcome);

    expect(summary.tone).toBe("warning");
    expect(summary.text).toContain("1 hard violation");
    expect(summary.text).toContain("provisional");
    expect(summary.text).toContain("NOT validated");
  });

  it("uses plural wording for a complete draft with violations", () => {
    const outcome: ValidationOutcome = {
      status: "ok",
      violations: [
        pairwise("entry-a", "entry-b"),
        { type: "CAPACITY", entryId: "entry-c", message: CAPACITY },
      ],
    };

    expect(validationSummary(outcome)).toEqual({
      tone: "danger",
      text: "2 hard violations found — shown on the affected rows below.",
    });
  });
});
