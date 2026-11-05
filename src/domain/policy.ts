/**
 * Policy configuration for the TAMS timetabling validator and generator.
 *
 * All values are ASSUMPTIONS (PROTOTYPE_SPEC §7) to be replaced after the
 * stakeholder meeting. The validator and generator receive a PolicyConfig
 * as a parameter — they never read policy values from globals or the clock.
 *
 * ASSUMPTION-9:  days Mon–Fri, slots hourly 08:00–17:00, lunch 13:00–14:00.
 * ASSUMPTION-10: max 6 teaching hours per lecturer per day, max 5 classes
 *                per group per day.
 */

export type PolicyConfig = {
  /** Teaching days of the week (ASSUMPTION-9). */
  days: readonly string[];
  /** Earliest slot start, HH:MM (ASSUMPTION-9). */
  slotStart: string;
  /** Latest slot end, HH:MM (ASSUMPTION-9). */
  slotEnd: string;
  /** Lunch break start, HH:MM — no class may overlap (ASSUMPTION-9). */
  lunchStart: string;
  /** Lunch break end, HH:MM (ASSUMPTION-9). */
  lunchEnd: string;
  /** Max teaching hours per lecturer per day (ASSUMPTION-10). */
  maxHoursPerLecturerPerDay: number;
  /** Max classes per student group per day (ASSUMPTION-10). */
  maxClassesPerGroupPerDay: number;
};

/**
 * Default policy from PROTOTYPE_SPEC §7.
 * Every value is an ASSUMPTION to be confirmed at the stakeholder meeting.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  days: ["MON", "TUE", "WED", "THU", "FRI"],
  slotStart: "08:00",
  slotEnd: "17:00",
  lunchStart: "13:00",
  lunchEnd: "14:00",
  maxHoursPerLecturerPerDay: 6,
  maxClassesPerGroupPerDay: 5,
};
