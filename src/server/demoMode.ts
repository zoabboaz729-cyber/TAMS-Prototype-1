/**
 * Demo-mode helpers for Kisii University TAMS (task M1-T3c-4).
 *
 * Pure functions: every input is passed as an argument. No process.env, no
 * database, no clock, no Next.js — fully unit-testable.
 */

import { normaliseEmail } from "./email";

/** Domain suffix reserved for demo accounts (all seed users use it). */
export const DEMO_EMAIL_DOMAIN = "@demo.tams.test";

/**
 * Demo mode is on only when DEMO_MODE is exactly "true" and the app is not
 * running in production. Any other value ("TRUE", "1", "", undefined)
 * disables it, and production always disables it regardless of DEMO_MODE.
 */
export function isDemoEnabled(
  demoMode: string | undefined,
  nodeEnv: string | undefined
): boolean {
  return demoMode === "true" && nodeEnv !== "production";
}

/**
 * True when the normalised email ends with the demo domain and has at least
 * one character before it. Rejects bare domains ("@demo.tams.test") and
 * look-alike domains ("x@demo.tams.test.evil.com").
 */
export function isDemoAccountEmail(email: string): boolean {
  const normalised = normaliseEmail(email);
  if (!normalised.endsWith(DEMO_EMAIL_DOMAIN)) return false;
  const prefix = normalised.slice(0, normalised.length - DEMO_EMAIL_DOMAIN.length);
  return prefix.length > 0;
}
