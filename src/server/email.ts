/**
 * Email normalisation for TAMS auth.
 * Trims whitespace and lowercases the address.
 * Does not validate format — the caller's schema does that.
 */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}
