/**
 * Pure session token functions for TAMS.
 * No Date.now(), no cookies, no database — fully testable as pure functions.
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { UserRoleSchema } from "@/domain/types";

/** 8 hours in milliseconds */
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

/** Zod schema for the JWT-like payload stored inside the token. */
const SessionPayloadSchema = z.object({
  userId: z.string().min(1),
  role: UserRoleSchema,
  expiresAtMs: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof SessionPayloadSchema>;

// ---------------------------------------------------------------------------
// Encoding helpers (base64url, no external dependency)
// ---------------------------------------------------------------------------

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  // Restore standard base64 padding
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const b64 = remainder === 0 ? padded : padded + "=".repeat(4 - remainder);
  return Buffer.from(b64, "base64").toString("utf8");
}

// ---------------------------------------------------------------------------
// HMAC helper
// ---------------------------------------------------------------------------

function sign(data: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("base64url");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a signed session token from a payload and a secret.
 * Format: <base64url(payload)>.<base64url(HMAC-SHA256 of first part)>
 */
export function createSessionToken(
  payload: SessionPayload,
  secret: string
): string {
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadPart, secret);
  return `${payloadPart}.${signature}`;
}

/**
 * Verifies a session token.
 * Returns the decoded payload on success, or null for any failure —
 * malformed token, bad signature, invalid role, or expired token.
 * Never throws.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number
): SessionPayload | null {
  try {
    // 1. Split into exactly two parts
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payloadPart, receivedSig] = parts as [string, string];
    if (!payloadPart || !receivedSig) return null;

    // 2. Verify signature using timingSafeEqual to prevent timing attacks
    const expectedSig = sign(payloadPart, secret);
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    const receivedBuf = Buffer.from(receivedSig, "utf8");

    // Length check required before timingSafeEqual
    if (expectedBuf.length !== receivedBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, receivedBuf)) return null;

    // 3. Decode and parse the payload (catch bad base64)
    let raw: string;
    try {
      raw = fromBase64Url(payloadPart);
    } catch {
      return null;
    }

    // 4. Parse JSON (catch bad JSON)
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    // 5. Validate against the schema (catches invalid role, missing fields, etc.)
    const result = SessionPayloadSchema.safeParse(parsed);
    if (!result.success) return null;

    // 6. Expiry check — reject tokens at exactly the expiry time or after
    if (result.data.expiresAtMs <= nowMs) return null;

    return result.data;
  } catch {
    return null;
  }
}
