/**
 * Shared login form schema for TAMS auth.
 *
 * - Email is trimmed BEFORE validation (surrounding whitespace is accepted,
 *   then removed), and must be a valid email address.
 * - Password must be non-empty and is intentionally never trimmed, so
 *   leading/trailing spaces are part of the credential.
 */
import { z } from "zod";
import { normaliseEmail } from "./email";

export const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

/**
 * Normalise a successfully parsed login email: trim (already done by the
 * schema) and lowercase, so lookups are case-insensitive.
 */
export function normaliseLoginEmail(email: string): string {
  return normaliseEmail(email);
}