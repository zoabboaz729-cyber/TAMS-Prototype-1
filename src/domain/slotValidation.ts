/**
 * OUT_OF_SLOT check for the TAMS conflict validator (PROTOTYPE_SPEC §7, M3-T1).
 *
 * Extracted from validator.ts (M3-T1b) so each module stays within the
 * repository's file-size guideline. Pure domain logic: no database, network,
 * Next.js, or clock.
 *
 * {@link checkSlot} returns the first OUT_OF_SLOT violation for an entry, or
 * null when the entry fits the policy slot grid. Day, time-format, ordering,
 * slot-window, and lunch-break are checked in that order so the message
 * identifies the most fundamental problem first. Half-open `[start, end)`
 * ranges are shared with the rest of the validator via `timesOverlap`
 * (lecturerAvailability.ts).
 *
 * Type-only imports from `./validator` (`EntryInput`, `Violation`) create no
 * runtime dependency — they are erased at compile time — so the runtime graph
 * runs one-way: validator → slotValidation.
 */

import type { EntryInput, Violation } from "./validator";
import type { PolicyConfig } from "./policy";
import { TIME_HHMM_REGEX, isStartBeforeEnd } from "./types";
import { timesOverlap } from "./lecturerAvailability";

/**
 * Check whether an entry falls inside the policy slot grid.
 * Returns the first OUT_OF_SLOT violation found, or null.
 * Day, time-format, ordering, slot-window, and lunch-break are checked in
 * that order so the message identifies the most fundamental problem first.
 */
export function checkSlot(
  entry: EntryInput,
  policy: PolicyConfig,
): Violation | null {
  if (!policy.days.includes(entry.day)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `${entry.day} is not a teaching day. Teaching days are ${policy.days.join(", ")}.`,
    };
  }

  if (!TIME_HHMM_REGEX.test(entry.start) || !TIME_HHMM_REGEX.test(entry.end)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: "Time must be a valid 24-hour HH:MM value.",
    };
  }

  if (!isStartBeforeEnd(entry.start, entry.end)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: "Start time must be earlier than end time.",
    };
  }

  if (entry.start < policy.slotStart) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class starts at ${entry.start} but the earliest slot is ${policy.slotStart}.`,
    };
  }

  if (entry.end > policy.slotEnd) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class ends at ${entry.end} but the latest slot is ${policy.slotEnd}.`,
    };
  }

  if (timesOverlap(entry.start, entry.end, policy.lunchStart, policy.lunchEnd)) {
    return {
      type: "OUT_OF_SLOT",
      entryId: entry.id,
      message: `Class overlaps the lunch break (${policy.lunchStart}-${policy.lunchEnd}).`,
    };
  }

  return null;
}
